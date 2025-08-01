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
from fpdf import FPDF   # ← PDF用追加

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
app.config['VERSION'] = '20250731'
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
        resp = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
                {"role": "user", "content": content}
            ]
        )
        text_report = resp.choices[0].message.content.strip()
    all_media = os.listdir(UPLOAD_DIR)
    images = [f for f in all_media if f.startswith("image_")]
    videos = [f for f in all_media if f.startswith("video_")]
    return render_template("daily_report.html", now=now, text_report=text_report, images=images, videos=videos)

# ─── 追加: サーバーでPDF生成 ─────────────────────────
@app.route("/generate_pdf", methods=["GET"])
def generate_pdf():
    now = (datetime.utcnow() + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")

    # 最新ログを要約
    files = sorted(glob.glob(os.path.join(LOG_DIR, "log_*.txt")))
    text_report = "ログがありません"
    if files:
        content = open(files[-1], encoding="utf-8").read()
        resp = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
                {"role": "user", "content": content}
            ]
        )
        text_report = resp.choices[0].message.content.strip()

    # PDF作成
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)
    pdf.cell(200, 10, "本日の見守りレポート", ln=True, align="C")
    pdf.set_font("Arial", size=10)
    pdf.cell(200, 10, f"作成日時: {now}", ln=True, align="C")

    pdf.set_font("Arial", size=12)
    pdf.multi_cell(0, 10, f"会話日報:\n{text_report}")
    pdf.ln(10)

    # 最新1枚の写真を追加（JPEG想定、幅70mm）
    all_media = os.listdir(UPLOAD_DIR)
    images = [f for f in all_media if f.startswith("image_")]
    if images:
        latest_img = os.path.join(UPLOAD_DIR, sorted(images)[-1])
        try:
            pdf.image(latest_img, x=10, y=pdf.get_y(), w=70)
        except Exception as e:
            logging.error(f"画像挿入エラー: {e}")

    # 出力
    pdf_bytes = pdf.output(dest="S").encode("latin1")
    return (pdf_bytes, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=daily_report.pdf"
    })

# ─── 3. カメラテスト ────────────────────────────────
@app.route("/camera-test/", methods=["GET"])
def camera_test():
    return render_template("camera_test.html")

# ─── 4. メディアアップロード ─────────────────────────
@app.route("/upload_media", methods=["POST"])
def upload_media():
    media_type = request.form.get("media_type")
    file = request.files.get("file")
    if not media_type or not file:
        return jsonify({"error": "media_type or file missing"}), 400

    # ── 古い動画は削除（動画アップロード時のみ）──
    if media_type == "video":
        for f in os.listdir(UPLOAD_DIR):
            if f.startswith("video_"):
                try:
                    os.remove(os.path.join(UPLOAD_DIR, f))
                    logging.info(f"古い動画削除: {f}")
                except Exception as e:
                    logging.error(f"古い動画削除エラー: {e}")

    # ── 保存処理 ──
    orig_name = file.filename
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
        return jsonify({"error": str(e)}), 500
