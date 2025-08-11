import os, glob, logging, tempfile, sys, mimetypes, uuid
from datetime import datetime, timedelta
from pathlib import Path
from io import BytesIO

from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, url_for
from flask_cors import CORS
from google.cloud import texttospeech
from openai import OpenAI
import stripe
from fpdf import FPDF
from PIL import Image
import httpx, openai as _o

# --------------------------------
# 基本設定
# --------------------------------
app = Flask(__name__)
CORS(app)

# 起動時のバージョン確認ログ（デバッグ用）
logging.basicConfig(level=logging.INFO)
logging.info(f"[BOOT] Python={sys.version}")
logging.info(f"[BOOT] httpx={httpx.__version__}")
logging.info(f"[BOOT] openai={_o.__version__}")

# APIキーなど
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
client = OpenAI(api_key=OPENAI_API_KEY)
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")

# 保存先（統一）
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
VIDEO_DIR = UPLOAD_DIR / "videos"
LOG_DIR = BASE_DIR / "logs"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
VIDEO_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

# アップロード制限
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100MB
ALLOWED_VIDEO_EXTS = {".webm", ".mp4", ".ogg", ".mov"}

# キャッシュ抑止
@app.after_request
def add_header(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

# --------------------------------
# 画面
# --------------------------------
@app.route("/", methods=["GET"])
@app.route("/ja/", methods=["GET"])
def index():
    return render_template("index.html")

@app.route("/camera-test/", methods=["GET"])
def camera_test():
    return render_template("camera_test.html")

# --------------------------------
# 日報関連（任意：使っている場合）
# --------------------------------

def _safe_list_media(dir_path: Path, exts: set[str]) -> list[str]:
    items = []
    try:
        p = Path(dir_path)
        if not p.exists():
            return items
        for child in p.iterdir():
            if child.is_file() and child.suffix.lower() in exts:
                items.append(child.name)  # ここは「名前のみ」を返す
    except Exception as e:
        logging.warning(f"list_media error at {dir_path}: {e}")
    return sorted(items)

# === /daily_report を丸ごと置換 ===
@app.route("/daily_report", methods=["GET"])
def daily_report():
    now = (datetime.utcnow() + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")

    # 会話要約（失敗しても続行）
    text_report = "ログがありません"
    try:
        files = sorted(glob.glob(str(LOG_DIR / "log_*.txt")))
        if files:
            content = open(files[-1], encoding="utf-8").read()
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
                    {"role": "user", "content": content}
                ]
            )
            text_report = resp.choices[0].message.content.strip()
    except Exception as e:
        logging.error(f"要約失敗: {e}")
        text_report = "要約に失敗しました"

    # 画像・動画を拡張子ベースで収集（videos/配下も見る）
    img_exts = {".jpg", ".jpeg", ".png"}
    vid_exts = {".webm", ".mp4", ".mov", ".ogg"}

    images = _safe_list_media(UPLOAD_DIR, img_exts)
    videos_root = _safe_list_media(UPLOAD_DIR, vid_exts)
    videos_sub  = _safe_list_media(VIDEO_DIR, vid_exts)

    # テンプレ側が `url_for('static', filename='uploads/' + path)` で読む想定
    videos = videos_root + [f"videos/{name}" for name in videos_sub]

    return render_template("daily_report.html",
                           now=now, text_report=text_report,
                           images=images, videos=videos)

@app.route("/generate_report_pdf", methods=["GET"])
def generate_report_pdf():
    now = (datetime.utcnow() + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)
    pdf.cell(200, 10, "本日の見守りレポート", ln=True, align="C")
    pdf.set_font("Arial", size=10)
    pdf.cell(200, 10, f"作成日時: {now}", ln=True, align="C")

    # 要約
    files = sorted(glob.glob(str(LOG_DIR / "log_*.txt")))
    text_report = "ログがありません"
    if files:
        content = open(files[-1], encoding="utf-8").read()
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
                    {"role": "user", "content": content}
                ]
            )
            text_report = resp.choices[0].message.content.strip()
        except Exception as e:
            logging.error(f"要約失敗: {e}")
            text_report = "要約に失敗しました"

    pdf.set_font("Arial", size=12)
    pdf.multi_cell(0, 10, f"会話日報:\n{text_report}")

    # 最新画像（カラー維持）
    all_media = os.listdir(UPLOAD_DIR)
    images = [f for f in all_media if f.startswith("image_")]
    if images:
        latest_img = str(UPLOAD_DIR / sorted(images)[-1])
        try:
            img = Image.open(latest_img).convert("RGB")
            w, h = img.size
            max_h = 150  # mm
            scale = max_h / h
            new_w, new_h = int(w * scale), int(h * scale)
            img = img.resize((new_w, new_h))

            tmp_jpg = None
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                tmp_jpg = tmp.name
                img.save(tmp_jpg, "JPEG", quality=92)

            y = pdf.get_y() + 10
            pdf.image(tmp_jpg, x=10, y=y, h=max_h)
        except Exception as e:
            logging.warning(f"画像挿入エラー: {e}")
        finally:
            try:
                if tmp_jpg and os.path.exists(tmp_jpg):
                    os.remove(tmp_jpg)
            except Exception:
                pass

    # 動画は注記
    videos = [f for f in all_media if f.startswith("video_")]
    if videos:
        pdf.ln(10)
        pdf.set_font("Arial", size=12)
        pdf.multi_cell(0, 10, "📹 最新の動画はサーバーに保存されています。")

    raw = pdf.output(dest="S")
    pdf_bytes = raw if isinstance(raw, (bytes, bytearray)) else raw.encode("latin-1")
    return (pdf_bytes, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=daily_report.pdf"
    })

# --------------------------------
# 画像→PDF（カラー）※カメラページ用
# --------------------------------
@app.post("/photo-to-pdf")
def photo_to_pdf():
    try:
        f = request.files.get("photo")
        if not f:
            return jsonify({"ok": False, "error": "no photo"}), 400

        img = Image.open(f.stream).convert("RGB")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            tmp_path = tmp.name
            img.save(tmp_path, "JPEG", quality=92)

        pdf = FPDF(unit="mm", format="A4")
        pdf.add_page()
        pdf.image(tmp_path, x=10, y=10, w=190)

        raw = pdf.output(dest="S")
        pdf_bytes = raw if isinstance(raw, (bytes, bytearray)) else raw.encode("latin-1")

        try:
            os.remove(tmp_path)
        except Exception:
            pass

        return send_file(BytesIO(pdf_bytes), mimetype="application/pdf", as_attachment=True, download_name="photo.pdf")
    except Exception as e:
        logging.exception(f"/photo-to-pdf error: {e}")
        return jsonify({"ok": False, "error": "pdf-failed"}), 500

# --------------------------------
# 動画アップロード（専用）
# --------------------------------
def _ext_from(mimetype_str, fallback=".webm"):
    ext = mimetypes.guess_extension(mimetype_str or "") or fallback
    return ext.lower()

def _is_allowed_ext(ext):
    return ext.lower() in ALLOWED_VIDEO_EXTS

def _cleanup_old_videos(keep=1):
    files = sorted((p for p in VIDEO_DIR.iterdir() if p.is_file()),
                   key=lambda p: p.stat().st_mtime,
                   reverse=True)
    for p in files[keep:]:
        try:
            p.unlink()
        except Exception:
            pass

@app.route("/upload_video", methods=["POST"])
def upload_video():
    if "video" not in request.files:
        return jsonify({"ok": False, "error": "no-file-field"}), 400

    f = request.files["video"]
    if not f or f.filename.strip() == "":
        return jsonify({"ok": False, "error": "empty-file"}), 400

    # 拡張子判定（filename優先→無ければmimetype）
    name_ext = os.path.splitext(f.filename)[1].lower()
    if not name_ext or not _is_allowed_ext(name_ext):
        name_ext = _ext_from(getattr(f, "mimetype", None), fallback=".webm")
    if not _is_allowed_ext(name_ext):
        return jsonify({"ok": False, "error": "unsupported-ext"}), 400

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    fname = f"{stamp}-{uuid.uuid4().hex}{name_ext}"
    save_path = VIDEO_DIR / fname
    f.save(save_path)

    # 古い動画は削除（最新のみ保持）
    _cleanup_old_videos(keep=1)

    # 即再生用URL
    url = url_for("static", filename=f"uploads/videos/{fname}")
    return jsonify({"ok": True, "url": url, "filename": fname}), 200

# --------------------------------
# 既存：メディアのアップロード（画像/動画 共通API）
# --------------------------------
@app.route("/upload_media", methods=["POST"])
def upload_media():
    """
    受け取り:
      - media_type: "image" | "video"
      - file: Blob/File
    動画は最新1件だけ保持（既存video_削除）
    """
    media_type = request.form.get("media_type")
    file = request.files.get("file")

    if not media_type or not file:
        return jsonify({"error": "media_type or file missing"}), 400

    # 動画は古いものを削除
    if media_type == "video":
        for f in os.listdir(UPLOAD_DIR):
            if f.startswith("video_"):
                try:
                    (UPLOAD_DIR / f).unlink()
                except Exception as e:
                    logging.warning(f"古い動画削除失敗: {f}, {e}")

    # 拡張子
    _, ext = os.path.splitext(file.filename or "")
    if not ext:
        ext = ".webm" if media_type == "video" else ".jpg"

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{media_type}_{ts}{ext}"
    save_path = UPLOAD_DIR / filename

    try:
        file.save(save_path)
        return jsonify({"status": "saved", "filename": filename, "url": f"/static/uploads/{filename}"}), 200
    except Exception as e:
        logging.error(f"保存エラー: {e}")
        return jsonify({"error": str(e)}), 500

# --------------------------------
# 用語説明（失敗時も200で短文を返す）
# --------------------------------
@app.route("/ja/explain", methods=["POST"])
def explain_term():
    try:
        data = request.get_json(silent=True) or {}
        term = (
            request.args.get("term")
            or request.form.get("term")
            or data.get("term")
            or request.args.get("word")
            or request.form.get("word")
            or data.get("word")
            or ""
        ).strip()

        max_len = int(
            request.args.get("maxLength")
            or request.form.get("maxLength")
            or data.get("maxLength")
            or 30
        )

        if not term:
            msg = "用語が空です"
            return jsonify({"explanation": msg, "definition": msg}), 400

        prompt = f"以下の用語を高齢者にも分かるように日本語で{max_len}文字以内で説明してください。\n用語: {term}"
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=120, temperature=0.2, timeout=12,
            )
            text = (resp.choices[0].message.content or "").strip() or "短い説明を生成できませんでした"
        except Exception as inner:
            logging.warning(f"OpenAI失敗: {inner}")
            text = f"{term}: かんたんな説明です"

        return jsonify({"explanation": text, "definition": text}), 200

    except Exception as e:
        logging.exception(f"/ja/explain error: {e}")
        msg = "説明に失敗しました"
        return jsonify({"explanation": msg, "definition": msg}), 200

# --------------------------------
# 翻訳（既存利用中なら）
# --------------------------------
@app.route("/ja/translate", methods=["POST"])
def translate_text():
    try:
        data = request.get_json(force=True)
        text = data.get("text", "")
        direction = data.get("direction", "ja-en")
        if not text:
            return jsonify({"error": "翻訳するテキストがありません"}), 400

        if direction == "ja-en":
            system_prompt = "次の日本語を英語に翻訳してください。"
        elif direction == "en-ja":
            system_prompt = "次の英語を日本語に翻訳してください。"
        elif direction == "ja-vi":
            system_prompt = "次の日本語をベトナム語に翻訳してください。"
        elif direction == "vi-ja":
            system_prompt = "次のベトナム語を日本語に翻訳してください。"
        elif direction == "ja-tl":
            system_prompt = "次の日本語をタガログ語に翻訳してください。"
        elif direction == "tl-ja":
            system_prompt = "次のタガログ語を日本語に翻訳してください。"
        else:
            return jsonify({"error": f"未対応の翻訳方向: {direction}"}), 400

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            max_tokens=150
        )
        translated = response.choices[0].message.content.strip()
        return jsonify({"translated": translated})
    except Exception as e:
        logging.error(f"翻訳エラー: {e}")
        return jsonify({"error": "翻訳に失敗しました"}), 500

# --------------------------------
# TTS（Google Cloud Text-to-Speech）
# --------------------------------
@app.route("/tts", methods=["POST"])
def tts():
    try:
        data = request.get_json(force=True)
        text = (data.get("text") or "").strip()
        # 入力例: "vi", "vi-VN", "tl", "fil-PH", "ja-JP", "en-US"
        req_lang = (data.get("lang") or "ja-JP").strip()

        if not text:
            return jsonify({"error": "読み上げるテキストがありません"}), 400

        # 言語コードを正規化
        lang_map = {
            "ja": "ja-JP",
            "en": "en-US",
            "vi": "vi-VN",
            "tl": "fil-PH",   # タガログ
            "fil": "fil-PH",
        }
        norm_lang = lang_map.get(req_lang.lower(), req_lang)

        # 声は任意（未指定でOK）
        voice_name = (data.get("voice") or "").strip() or None

        client_tts = texttospeech.TextToSpeechClient()
        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice = texttospeech.VoiceSelectionParams(language_code=norm_lang, name=voice_name)
        audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)

        response = client_tts.synthesize_speech(
            input=synthesis_input, voice=voice, audio_config=audio_config
        )
        return (response.audio_content, 200, {"Content-Type": "audio/mpeg"})
    except Exception as e:
        logging.error(f"TTSエラー: {e}")
        return jsonify({"error": "TTSに失敗しました"}), 500

# --------------------------------
# アップロード配信（必要なら）
# --------------------------------
@app.route("/uploads/<path:filename>", methods=["GET"])
def serve_uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)

# --------------------------------
# テストPDF（依存確認用・任意）
# --------------------------------
@app.get("/test-pdf")
def test_pdf():
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=16)
    pdf.cell(0, 10, "PDF OK", ln=True)
    raw = pdf.output(dest="S")
    data = raw if isinstance(raw, (bytes, bytearray)) else raw.encode("latin-1")
    return (data, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=test.pdf"
    })

@app.route("/ja/save_log", methods=["POST"])
def save_log():
    data = request.get_json(silent=True) or {}
    log_text = (data.get("log") or "").strip()
    if not log_text:
        return jsonify({"ok": False, "error": "empty-log"}), 400
    ts = (datetime.utcnow() + timedelta(hours=9)).strftime("%Y%m%d_%H%M%S")
    path = LOG_DIR / f"log_{ts}.txt"
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(log_text)
        return jsonify({"ok": True, "status": "success"})
    except Exception as e:
        logging.error(f"save_log error: {e}")
        return jsonify({"ok": False, "error": "write-failed"}), 500

# --------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
