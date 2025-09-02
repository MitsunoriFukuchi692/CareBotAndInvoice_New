# app.py — carebotandinvoice-v2 本番用（重複整理版）
# 右下バッジ用の /version、ヘルス /healthz・/readyz、デバッグ /__test__ も1か所で定義

import os, sys, glob, logging, tempfile, mimetypes, uuid, datetime
from pathlib import Path
from io import BytesIO

from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, url_for
from flask_cors import CORS
from PIL import Image
from fpdf import FPDF
from google.cloud import texttospeech
from openai import OpenAI
import httpx
import openai as _o

print("Using GOOGLE_APPLICATION_CREDENTIALS:", os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))

# --------------------------------
# 基本設定
# --------------------------------
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100MB
CORS(app)

# 起動ログ
logging.basicConfig(level=logging.INFO)
logging.info(f"[BOOT] Python={sys.version}")
logging.info(f"[BOOT] httpx={httpx.__version__}")
logging.info(f"[BOOT] openai={_o.__version__}")

# ディレクトリ
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
VIDEO_DIR  = UPLOAD_DIR / "videos"
LOG_DIR    = BASE_DIR / "logs"
for d in (UPLOAD_DIR, VIDEO_DIR, LOG_DIR):
    d.mkdir(parents=True, exist_ok=True)

# APIキーなど
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
client = OpenAI(api_key=OPENAI_API_KEY)

# --------------------------------
# /version /healthz /readyz /__test__（ここで一括定義）
# --------------------------------
from flask import jsonify  # 局所import可

STARTED_AT = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
VERSION_INFO = {
    "service": os.getenv("SERVICE_NAME", "carebotandinvoice-v2"),
    "git": (os.getenv("GIT_SHA") or os.getenv("RENDER_GIT_COMMIT", ""))[:7],
    "built": os.getenv("BUILD_TIME", STARTED_AT),
    "env": os.getenv("RENDER_SERVICE_NAME", ""),
}

@app.context_processor
def inject_version_info():
    # index.html から {{ version_info.* }} で参照
    return dict(version_info=VERSION_INFO)

@app.route("/version")
def version():
    return jsonify(VERSION_INFO), 200

@app.route("/healthz")
def healthz():
    return "ok", 200

@app.route("/readyz")
def readyz():
    # 依存先チェックが必要なら required にENV名を列挙
    required = []  # 例: ["SUPABASE_URL", "SUPABASE_KEY"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        return jsonify({"ready": False, "missing_env": missing}), 503
    return jsonify({"ready": True}), 200

@app.route("/__test__")
def __test__():
    return "__test__ ok", 200

# --------------------------------
# 共通ユーティリティ
# --------------------------------
def jst_now_str(fmt="%Y-%m-%d %H:%M"):
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime(fmt)

def _safe_list_media(dir_path: Path, exts: set[str]) -> list[str]:
    items = []
    try:
        if not dir_path.exists(): return items
        for p in dir_path.iterdir():
            if p.is_file() and p.suffix.lower() in exts:
                items.append(p.name)
    except Exception as e:
        logging.warning(f"list_media error at {dir_path}: {e}")
    return sorted(items)

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

@app.get("/camera-test/")
def camera_test():
    return render_template("camera_test.html")

# --------------------------------
# 日報関連
# --------------------------------
@app.get("/daily_report")
def daily_report():
    now = jst_now_str()

    # 会話ログの要約（失敗しても継続）
    text_report = "ログがありません"
    try:
        files = sorted(glob.glob(str(LOG_DIR / "log_*.txt")))
        if files:
            content = open(files[-1], encoding="utf-8").read()
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
                    {"role": "user", "content": content},
                ],
                max_tokens=250,
                temperature=0.2,
            )
            text_report = (resp.choices[0].message.content or "").strip() or text_report
    except Exception as e:
        logging.error(f"要約失敗: {e}")

    img_exts = {".jpg", ".jpeg", ".png"}
    vid_exts = {".webm", ".mp4", ".mov", ".ogg"}
    images = _safe_list_media(UPLOAD_DIR, img_exts)
    videos_root = _safe_list_media(UPLOAD_DIR, vid_exts)
    videos_sub  = _safe_list_media(VIDEO_DIR, vid_exts)
    videos = videos_root + [f"videos/{name}" for name in videos_sub]

    return render_template("daily_report.html",
                           now=now, text_report=text_report,
                           images=images, videos=videos)

@app.get("/generate_report_pdf")
def generate_report_pdf():
    now = jst_now_str()

    # 要約テキスト
    files = sorted(glob.glob(str(LOG_DIR / "log_*.txt")))
    text_report = "ログがありません"
    if files:
        content = open(files[-1], encoding="utf-8").read()
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
                    {"role": "user", "content": content},
                ],
                max_tokens=250,
                temperature=0.2,
            )
            text_report = (resp.choices[0].message.content or "").strip() or text_report
        except Exception as e:
            logging.error(f"要約失敗: {e}")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)
    pdf.cell(0, 10, "本日の見守りレポート", ln=True, align="C")
    pdf.set_font("Arial", size=10)
    pdf.cell(0, 8, f"作成日時: {now}", ln=True, align="C")

    pdf.set_font("Arial", size=12)
    pdf.multi_cell(0, 8, f"会話日報:\n{text_report}")

    # 最新画像（カラー）
    all_media = os.listdir(UPLOAD_DIR)
    images = [f for f in all_media if f.lower().startswith("image_")]
    if images:
        latest_img = str(UPLOAD_DIR / sorted(images)[-1])
        try:
            img = Image.open(latest_img).convert("RGB")
            w, h = img.size
            max_h = 150  # mm
            scale = max_h / h
            img = img.resize((int(w*scale), int(h*scale)))
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                tmp_jpg = tmp.name
            img.save(tmp_jpg, "JPEG", quality=92)
            y = pdf.get_y() + 6
            pdf.image(tmp_jpg, x=10, y=y, h=max_h)
            os.remove(tmp_jpg)
        except Exception as e:
            logging.warning(f"画像挿入エラー: {e}")

    raw = pdf.output(dest="S")
    pdf_bytes = raw if isinstance(raw, (bytes, bytearray)) else raw.encode("latin-1")
    return (pdf_bytes, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=daily_report.pdf"
    })

# --------------------------------
# 画像→PDF（カラー）
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
        os.remove(tmp_path)

        return send_file(BytesIO(pdf_bytes), mimetype="application/pdf",
                         as_attachment=True, download_name="photo.pdf")
    except Exception as e:
        logging.exception(f"/photo-to-pdf error: {e}")
        return jsonify({"ok": False, "error": "pdf-failed"}), 500

# --------------------------------
# 動画アップロード（専用）
# --------------------------------
ALLOWED_VIDEO_EXTS = {".webm", ".mp4", ".ogg", ".mov"}

def _ext_from(mimetype_str, fallback=".webm"):
    ext = mimetypes.guess_extension(mimetype_str or "") or fallback
    return ext.lower()

def _is_allowed_ext(ext):
    return ext.lower() in ALLOWED_VIDEO_EXTS

def _cleanup_old_videos(keep=1):
    files = sorted((p for p in VIDEO_DIR.iterdir() if p.is_file()),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files[keep:]:
        try: p.unlink()
        except Exception: pass

@app.post("/upload_video")
def upload_video():
    if "video" not in request.files:
        return jsonify({"ok": False, "error": "no-file-field"}), 400
    f = request.files["video"]
    if not f or not f.filename.strip():
        return jsonify({"ok": False, "error": "empty-file"}), 400

    name_ext = os.path.splitext(f.filename)[1].lower()
    if not name_ext or not _is_allowed_ext(name_ext):
        name_ext = _ext_from(getattr(f, "mimetype", None), fallback=".webm")
    if not _is_allowed_ext(name_ext):
        return jsonify({"ok": False, "error": "unsupported-ext"}), 400

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    fname = f"{stamp}-{uuid.uuid4().hex}{name_ext}"
    save_path = VIDEO_DIR / fname
    f.save(save_path)

    _cleanup_old_videos(keep=1)
    url = url_for("static", filename=f"uploads/videos/{fname}")
    return jsonify({"ok": True, "url": url, "filename": fname}), 200

# --------------------------------
# 既存：メディアのアップロード（画像/動画 共通API）
# --------------------------------
@app.post("/upload_media")
def upload_media():
    """
    受け取り:
      - media_type: "image" | "video"
      - file: Blob/File
    動画は最新1件だけ保持（旧video_を削除）
    """
    media_type = request.form.get("media_type")
    file = request.files.get("file")
    if not media_type or not file:
        return jsonify({"error": "media_type or file missing"}), 400

    if media_type == "video":
        for f in os.listdir(UPLOAD_DIR):
            if f.startswith("video_"):
                try: (UPLOAD_DIR / f).unlink()
                except Exception as e: logging.warning(f"古い動画削除失敗: {f}, {e}")

    _, ext = os.path.splitext(file.filename or "")
    if not ext:
        ext = ".webm" if media_type == "video" else ".jpg"

    ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{media_type}_{ts}{ext}"
    save_path = UPLOAD_DIR / filename

    try:
        file.save(save_path)
        return jsonify({"status": "saved", "filename": filename,
                        "url": f"/static/uploads/{filename}"}), 200
    except Exception as e:
        logging.error(f"保存エラー: {e}")
        return jsonify({"error": str(e)}), 500

# --------------------------------
# 用語説明（短文・失敗時も200）
# --------------------------------
@app.post("/ja/explain")
def explain_term():
    try:
        data = request.get_json(silent=True) or {}
        term = (
            request.args.get("term") or request.form.get("term") or data.get("term") or
            request.args.get("word") or request.form.get("word") or data.get("word") or ""
        ).strip()
        max_len = int(
            request.args.get("maxLength") or request.form.get("maxLength") or data.get("maxLength") or 30
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
            text = (resp.choices[0].message.content or "").strip() or f"{term}: かんたんな説明です"
        except Exception as inner:
            logging.warning(f"OpenAI失敗: {inner}")
            text = f"{term}: かんたんな説明です"

        return jsonify({"explanation": text, "definition": text}), 200
    except Exception as e:
        logging.exception(f"/ja/explain error: {e}")
        msg = "説明に失敗しました"
        return jsonify({"explanation": msg, "definition": msg}), 200

# --------------------------------
# 翻訳
# --------------------------------
@app.post("/ja/translate")
def translate_text():
    try:
        data = request.get_json(force=True)
        text = data.get("text", "")
        direction = data.get("direction", "ja-en")
        if not text:
            return jsonify({"error": "翻訳するテキストがありません"}), 400

        if   direction == "ja-en": sys_prompt = "次の日本語を英語に翻訳してください。"
        elif direction == "en-ja": sys_prompt = "次の英語を日本語に翻訳してください。"
        elif direction == "ja-vi": sys_prompt = "次の日本語をベトナム語に翻訳してください。"
        elif direction == "vi-ja": sys_prompt = "次のベトナム語を日本語に翻訳してください。"
        elif direction == "ja-tl": sys_prompt = "次の日本語をタガログ語に翻訳してください。"
        elif direction == "tl-ja": sys_prompt = "次のタガログ語を日本語に翻訳してください。"
        else:
            return jsonify({"error": f"未対応の翻訳方向: {direction}"}), 400

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": sys_prompt},
                      {"role": "user", "content": text}],
            max_tokens=200
        )
        translated = (response.choices[0].message.content or "").strip()
        return jsonify({"translated": translated})
    except Exception as e:
        logging.error(f"翻訳エラー: {e}")
        return jsonify({"error": "翻訳に失敗しました"}), 500

# --------------------------------
# TTS（Google Text-to-Speech）
# --------------------------------
def _normalize_lang(code: str) -> str:
    if not code: return "ja-JP"
    c = code.strip().lower()
    if c in ("ja", "ja-jp"): return "ja-JP"
    if c in ("en", "en-us"): return "en-US"
    if c in ("vi", "vi-vn"): return "vi-VN"
    if c in ("tl", "tl-ph", "fil", "fil-ph"): return "fil-PH"
    return code

_PREFERRED = {
    "ja-JP": "ja-JP-Neural2-D",
    "en-US": "en-US-Neural2-C",
    "vi-VN": "vi-VN-Wavenet-A",
    "fil-PH": "fil-PH-Wavenet-A",
}

def _synthesize_mp3(client_tts, text: str, lang: str, voice: str|None,
                    rate: float, pitch: float, volume_db: float) -> bytes:
    if not text.strip(): raise ValueError("text is empty")
    if not voice: voice = _PREFERRED.get(lang)
    synthesis_input = texttospeech.SynthesisInput(text=text)
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=float(rate), pitch=float(pitch), volume_gain_db=float(volume_db)
    )
    try:
        voice_sel = texttospeech.VoiceSelectionParams(language_code=lang, name=voice)
        resp = client_tts.synthesize_speech(input=synthesis_input, voice=voice_sel, audio_config=audio_config)
    except Exception:
        voice_sel = texttospeech.VoiceSelectionParams(language_code=lang)
        resp = client_tts.synthesize_speech(input=synthesis_input, voice=voice_sel, audio_config=audio_config)
    return resp.audio_content

@app.route("/tts", methods=["POST", "GET", "OPTIONS"])
def tts():
    if request.method == "OPTIONS": return ("", 204)
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        text  = (data.get("text") or "").strip()
        lang  = _normalize_lang(data.get("lang") or "ja-JP")
        voice = data.get("voice")
        rate  = float(data.get("rate", 1.0))
        pitch = float(data.get("pitch", 0.0))
        vol   = float(data.get("volume", 0.0))
    else:
        text  = (request.args.get("text") or "").strip()
        lang  = _normalize_lang(request.args.get("lang") or "ja-JP")
        voice = request.args.get("voice")
        rate  = float(request.args.get("rate", 1.0))
        pitch = float(request.args.get("pitch", 0.0))
        vol   = float(request.args.get("volume", 0.0))
    if not text: return jsonify({"error": "読み上げるテキストがありません"}), 400

    try:
        client_tts = texttospeech.TextToSpeechClient()
        audio = _synthesize_mp3(client_tts, text, lang, voice, rate, pitch, vol)
        return (audio, 200, {
            "Content-Type": "audio/mpeg",
            "Content-Disposition": 'inline; filename="tts.mp3"',
            "Cache-Control": "no-store",
        })
    except Exception as e:
        logging.exception("TTSエラー")
        return jsonify({"error": f"TTSに失敗しました: {e}"}), 500

# --------------------------------
# 配信とユーティリティ
# --------------------------------
@app.get("/uploads/<path:filename>")
def serve_uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)

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

@app.post("/ja/save_log")
def save_log():
    data = request.get_json(silent=True) or {}
    log_text = (data.get("log") or "").strip()
    if not log_text:
        return jsonify({"ok": False, "error": "empty-log"}), 400
    ts = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime("%Y%m%d_%H%M%S")
    path = LOG_DIR / f"log_{ts}.txt"
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(log_text)
        return jsonify({"ok": True, "status": "success"})
    except Exception as e:
        logging.error(f"save_log error: {e}")
        return jsonify({"ok": False, "error": "write-failed"}), 500

# --- 追加: 翻訳ページ ---
@app.get("/translate")
def translate_page():
    return render_template("translate.html")

# --------------------------------
# エントリポイント
# --------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
