import os, glob, logging, tempfile
from io import BytesIO
from datetime import datetime, timedelta

from flask import (
    Flask, render_template, request,
    jsonify, redirect, send_from_directory,
    url_for
)
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from google.cloud import texttospeech
import openai
from openai import OpenAI
import stripe
from fpdf import FPDF   # fpdf2 を利用

# ─── ログ設定 ─────────────────────────────────────
logging.basicConfig(level=logging.DEBUG)

# ─── Google 認証設定 ─────────────────────────────────
KEY_JSON_ENV = "GOOGLE_CREDENTIALS_JSON"
json_str = os.getenv(KEY_JSON_ENV) or ""
with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as tmp:
    tmp.write(json_str.encode("utf-8"))
    tmp.flush()
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp.name

# ─── Flask 初期化 ───────────────────────────────────
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config['VERSION'] = '20250801'
CORS(app)
limiter = Limiter(app, key_func=get_remote_address, default_limits=["10 per minute"])

# ─── API キー設定 ────────────────────────────────────
openai.api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=openai.api_key)
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

# ─── 保存フォルダ準備 ───────────────────────────────
UPLOAD_DIR, LOG_DIR = "uploads", "logs"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

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

# ─── 2. 日報生成（HTML表示）──────────────────────────
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

# ─── 3. サーバーでPDF生成 ─────────────────────────
@app.route("/generate_pdf", methods=["GET"])
def generate_pdf():
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

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)
    pdf.cell(200, 10, "本日の見守りレポート", ln=True, align="C")
    pdf.set_font("Arial", size=10)
    pdf.cell(200, 10, f"作成日時: {now}", ln=True, align="C")
    pdf.set_font("Arial", size=12)
    pdf.multi_cell(0, 10, f"会話日報:\n{text_report}")
    pdf.ln(10)

    # 最新1枚の写真を追加（カラーJPEG、幅70mm）
    all_media = os.listdir(UPLOAD_DIR)
    images = [f for f in all_media if f.startswith("image_")]
    if images:
        latest_img = os.path.join(UPLOAD_DIR, sorted(images)[-1])
        try:
            pdf.image(latest_img, x=10, y=pdf.get_y(), w=70)
        except Exception as e:
            logging.warning(f"画像挿入エラー: {e}")

    pdf_bytes = pdf.output(dest="S").encode("latin1")
    return (pdf_bytes, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=daily_report.pdf"
    })

# ─── 4. カメラテスト ────────────────────────────────
@app.route("/camera-test/", methods=["GET"])
def camera_test():
    return render_template("camera_test.html")

# ─── 5. メディアアップロード ─────────────────────────
@app.route("/upload_media", methods=["POST"])
def upload_media():
    media_type = request.form.get("media_type")
    file = request.files.get("file")
    if not media_type or not file:
        return jsonify({"error": "media_type or file missing"}), 400

    # 古い動画は削除（動画は常に最新1件だけ保持）
    if media_type == "video":
        for f in os.listdir(UPLOAD_DIR):
            if f.startswith("video_"):
                try:
                    os.remove(os.path.join(UPLOAD_DIR, f))
                    logging.info(f"古い動画削除: {f}")
                except Exception as e:
                    logging.warning(f"古い動画削除失敗: {f}, {e}")

    # 保存処理
    orig_name = file.filename or ""
    _, ext = os.path.splitext(orig_name)
    if not ext:
        ext = ".webm" if media_type == "video" else ".jpg"  # 写真はJPEG想定
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
        term = data.get("term", "")
        if not term:
            return jsonify({"error": "用語が空です"}), 400

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "入力された用語を30文字以内で簡単に日本語で説明してください。"},
                {"role": "user", "content": term}
            ],
            max_tokens=50
        )
        explanation = response.choices[0].message.content.strip()
        return jsonify({"explanation": explanation})

    except Exception as e:
        logging.error(f"用語説明エラー: {e}")
        return jsonify({"error": "用語説明に失敗しました"}), 500

# ─── 翻訳 ───────────────────────────────
@app.route("/ja/translate", methods=["POST"])
def translate_text():
    try:
        data = request.get_json()
        text = data.get("text", "")
        direction = data.get("direction", "ja-en")  # ja-en or en-ja

        if not text:
            return jsonify({"error": "翻訳するテキストがありません"}), 400

        if direction == "ja-en":
            system_prompt = "次の日本語を英語に翻訳してください。"
        else:
            system_prompt = "次の英語を日本語に翻訳してください。"

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            max_tokens=100
        )
        translated = response.choices[0].message.content.strip()
        return jsonify({"translated": translated})

    except Exception as e:
        logging.error(f"翻訳エラー: {e}")
        return jsonify({"error": "翻訳に失敗しました"}), 500

# ─── 会話ログ保存 ───────────────────────────────
@app.route("/ja/save_log", methods=["POST"])
def save_log():
    try:
        data = request.get_json()
        log_text = data.get("log", "").strip()
        if not log_text:
            return jsonify({"error": "ログが空です"}), 400

        # ファイル名（日時付き）
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = os.path.join(LOG_DIR, f"log_{ts}.txt")

        with open(filename, "w", encoding="utf-8") as f:
            f.write(log_text)

        logging.info(f"会話ログ保存: {filename}")
        return jsonify({"status": "success", "filename": filename})

    except Exception as e:
        logging.error(f"会話ログ保存エラー: {e}")
        return jsonify({"error": "会話ログ保存に失敗しました"}), 500

# ─── アップロード済みファイルを配信 ─────────────────────────
@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    try:
        return send_from_directory(UPLOAD_DIR, filename)
    except Exception as e:
        logging.error(f"ファイル配信エラー: {e}")
        return "ファイルが見つかりません", 404

# ─── メイン ───────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
