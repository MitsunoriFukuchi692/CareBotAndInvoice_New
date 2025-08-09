import os, glob, logging, tempfile
from datetime import datetime, timedelta
from flask import (
    Flask, render_template, request,
    jsonify, send_from_directory)
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from google.cloud import texttospeech
import openai
from openai import OpenAI
import stripe
from fpdf import FPDF
from PIL import Image
import os, time
from io import BytesIO
from pathlib import Path

app = Flask(__name__)
CORS(app)

# ─── API キー設定 ────────────────────────────────────
openai.api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=openai.api_key)
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

# ─── 保存フォルダ準備（統一）────────────────────────
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "uploads"   # ← 統一
LOG_DIR = BASE_DIR / "logs"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

# ─── キャッシュ無効化 ─────────────────────────────────
@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ─── 1. トップ画面 ───────────────────────────────────
@app.route("/", methods=["GET"])
@app.route("/ja/", methods=["GET"])
def index():
    return render_template("index.html")

# ─── 2. 日報生成（HTML表示＋PDF生成）──────────────────
@app.route("/daily_report", methods=["GET"])
def daily_report():
    now = (datetime.utcnow() + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")
    files = sorted(glob.glob(os.path.join(LOG_DIR, "log_*.txt")))
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

    all_media = os.listdir(UPLOAD_DIR)
    images = [f for f in all_media if f.startswith("image_")]
    videos = [f for f in all_media if f.startswith("video_")]
    return render_template("daily_report.html", now=now, text_report=text_report, images=images, videos=videos)

@app.route("/generate_report_pdf", methods=["GET"])
def generate_report_pdf():
    now = (datetime.utcnow() + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)
    pdf.cell(200, 10, "本日の見守りレポート", ln=True, align="C")
    pdf.set_font("Arial", size=10)
    pdf.cell(200, 10, f"作成日時: {now}", ln=True, align="C")

    # 直近ログ要約
    files = sorted(glob.glob(os.path.join(LOG_DIR, "log_*.txt")))
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

    # 最新の写真（縮小＋高さ固定・カラー維持）
    all_media = os.listdir(UPLOAD_DIR)
    images = [f for f in all_media if f.startswith("image_")]
    if images:
        latest_img = os.path.join(UPLOAD_DIR, sorted(images)[-1])
        try:
            from io import BytesIO
            import tempfile

            img = Image.open(latest_img).convert("RGB")
            w, h = img.size

            max_h = 150  # mm（A4内に収まる高さ）
            scale = max_h / h
            new_w, new_h = int(w * scale), int(h * scale)
            img = img.resize((new_w, new_h))

            # 一時JPGに正規化（拡張子非依存＆カラー維持）
            tmp_jpg = None
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                tmp_jpg = tmp.name
                img.save(tmp_jpg, "JPEG", quality=92)

            y_before = pdf.get_y() + 10
            pdf.image(tmp_jpg, x=10, y=y_before, h=max_h)
        except Exception as e:
            logging.warning(f"画像挿入エラー: {e}")
        finally:
            try:
                if tmp_jpg and os.path.exists(tmp_jpg):
                    os.remove(tmp_jpg)
            except Exception:
                pass

    # 動画は注記のみ
    videos = [f for f in all_media if f.startswith("video_")]
    if videos:
        pdf.ln(10)
        pdf.set_font("Arial", size=12)
        pdf.multi_cell(0, 10, "📹 最新の動画はサーバーに保存されています。")

    pdf_bytes = pdf.output(dest="S").encode("latin-1")
    return (pdf_bytes, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=daily_report.pdf"
    })

# ─── 4. カメラテスト ────────────────────────────────
@app.route("/camera-test/", methods=["GET"])
def camera_test():
    return render_template("camera_test.html")

# ─── 5. メディアアップロード（最新1件運用）───────────
@app.route("/upload_media", methods=["POST"])
def upload_media():
    """
    フロントから
      - media_type: "image" | "video"
      - file: Blob/File
    を受け取り保存。動画は常に最新1件だけ保持。
    """
    media_type = request.form.get("media_type")
    file = request.files.get("file")

    if not media_type or not file:
        return jsonify({"error": "media_type or file missing"}), 400

    # 古い動画は削除（最新1件のみ保持）
    if media_type == "video":
        for f in os.listdir(UPLOAD_DIR):
            if f.startswith("video_"):
                try:
                    os.remove(os.path.join(UPLOAD_DIR, f))
                    logging.info(f"古い動画削除: {f}")
                except Exception as e:
                    logging.warning(f"古い動画削除失敗: {f}, {e}")

    _, ext = os.path.splitext(file.filename or "")
    if not ext:
        ext = ".webm" if media_type == "video" else ".jpg"
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{media_type}_{ts}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)

    try:
        file.save(path)
        return jsonify({"status": "saved", "filename": filename}), 200
    except Exception as e:
        logging.error(f"保存エラー: {e}")
        return jsonify({"error": str(e)}), 500

# ─── 6. 用語説明 ───────────────────────────────
@app.route("/ja/explain", methods=["POST"])
def explain_term():
    try:
        data = request.get_json()
        word = data.get("word", "").strip()
        if not word:
            return jsonify({"error": "word is required"}), 400

        prompt = f"以下の用語を高齢者にも分かるように日本語で30文字以内で説明してください。\n用語: {word}"
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=80,
            temperature=0.2
        )
        short_def = resp.choices[0].message.content.strip()
        return jsonify({"definition": short_def})
    except Exception as e:
        logging.error(f"用語説明エラー: {e}")
        return jsonify({"error": "用語説明に失敗しました"}), 500

# ─── 翻訳 ───────────────────────────────
@app.route("/ja/translate", methods=["POST"])
def translate_text():
    try:
        data = request.get_json()
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

# ─── TTS（Google Cloud Text-to-Speech）───────────────
@app.route("/tts", methods=["POST"])
def tts():
    try:
        data = request.get_json()
        text = data.get("text", "")
        lang = data.get("lang", "ja-JP")
        voice_name = data.get("voice", "")  # 例: "ja-JP-Wavenet-A"

        if not text:
            return jsonify({"error": "読み上げるテキストがありません"}), 400

        client_tts = texttospeech.TextToSpeechClient()
        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice = texttospeech.VoiceSelectionParams(
            language_code=lang,
            name=voice_name or None,
        )
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3
        )
        response = client_tts.synthesize_speech(
            input=synthesis_input, voice=voice, audio_config=audio_config
        )
        return (response.audio_content, 200, {"Content-Type": "audio/mpeg"})
    except Exception as e:
        logging.error(f"TTSエラー: {e}")
        return jsonify({"error": "TTSに失敗しました"}), 500

# === ここから追記 =========================================
# 既存のUPLOAD_DIRを使用

# 画像 → PDF（カラー維持・単体API）
@app.post("/photo-to-pdf")
def photo_to_pdf():
    f = request.files.get("photo")
    if not f:
        return jsonify({"ok": False, "error": "no photo"}), 400

    img = Image.open(f.stream).convert("RGB")
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=92)
    buf.seek(0)

    pdf = FPDF(unit="mm", format="A4")
    pdf.add_page()
    pdf.image(buf, x=10, y=10, w=190)

    pdf_bytes = pdf.output(dest="S").encode("latin-1")
    return (pdf_bytes, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=photo.pdf"
    })

# 動画アップロード（別口API・必要なら使用）
@app.post("/upload-video")
def upload_video():
    f = request.files.get("video")
    if not f:
        return jsonify({"ok": False, "error": "no file"}), 400

    # 既存の動画は全削除（最新1件運用）
    for name in os.listdir(UPLOAD_DIR):
        if name.startswith("video_"):
            try:
                os.remove(os.path.join(UPLOAD_DIR, name))
            except Exception as e:
                logging.warning(f"古い動画削除失敗: {name}, {e}")

    mime = (f.mimetype or "").lower()
    ext = ".mp4" if "mp4" in mime else ".webm"
    filename = f"video_{int(time.time())}{ext}"
    save_path = os.path.join(UPLOAD_DIR, filename)
    try:
        f.save(save_path)
    except Exception as e:
        logging.error(f"動画保存エラー: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500

    return jsonify({"ok": True, "url": f"/static/uploads/{filename}"})
# === ここまで追記 =========================================

# ─── メディア配信（必要なら）────────────────────────
@app.route("/uploads/<path:filename>", methods=["GET"])
def serve_uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)

# ─── メイン ───────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
