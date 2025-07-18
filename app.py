import os
import json
import glob
import logging
import tempfile
from io import BytesIO
from datetime import datetime, timedelta

from flask import (
    Flask, render_template, request,
    jsonify, redirect, send_from_directory,
    send_file
)
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from google.cloud import texttospeech
import openai
from openai import OpenAI
import stripe

# ─── ログ設定 ─────────────────────────────────────
logging.basicConfig(level=logging.DEBUG)

# ─── Google 認証設定 ─────────────────────────────────
KEY_JSON_ENV = "GOOGLE_CREDENTIALS_JSON"
json_str = os.getenv(KEY_JSON_ENV)
if not json_str:
    raise RuntimeError(f"Missing required env var: {KEY_JSON_ENV}")
with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as tmp:
    tmp.write(json_str.encode("utf-8"))
    tmp.flush()
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp.name

# ─── Flask アプリ初期化 ────────────────────────────────
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
CORS(app, origins=["https://robostudy.jp"], supports_credentials=True)
limiter = Limiter(app, key_func=get_remote_address, default_limits=["10 per minute"])

# ─── API キー設定 ────────────────────────────────────
openai.api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=openai.api_key)
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

# ─── キャッシュ無効化 ─────────────────────────────────
@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ─── カメラテスト専用ルート ───────────────────────────
@app.route("/camera-test/", methods=["GET"])
def camera_test():
    """
    templates/camera_test.html を返す。
    ここに WebRTC カメラプレビュー用HTMLを置いてください。
    """
    return render_template("camera_test.html")

# ─── SPA キャッチオール ─────────────────────────────────
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    # static 内のファイルがあれば返す
    full = os.path.join(app.static_folder, path)
    if path and os.path.isfile(full):
        return send_from_directory(app.static_folder, path)
    # それ以外はメインの index.html
    return render_template("index.html")

# ─── 以下、既存の /ja/... や /chat, /logs, /create_invoice エンドポイント群 ───────────────

@app.route("/ja/templates", methods=["GET"])
def get_templates():
    return jsonify([
        # ... (もとのまま全コードをここにコピー＆ペースト)
    ])

@app.route("/ja/chat", methods=["POST"])
def chat_ja():
    # ... 省略せず元の実装

@app.route("/ja/explain", methods=["POST"])
def explain():
    # ...

@app.route("/ja/translate", methods=["POST"])
def translate():
    # ...

@app.route("/ja/save_log", methods=["POST"])
def save_log():
    # ...

@app.route("/ja/daily_report", methods=["GET"])
def daily_report():
    # ...

@app.route("/chat", methods=["POST"])
@limiter.limit("3 per 10 seconds")
def chat_tts():
    # ...

@app.route("/logs")
def logs():
    # ...

@app.route("/download-logs")
def download_logs():
    # ...

@app.route("/create_invoice", methods=["POST"])
def create_invoice():
    # ...

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
