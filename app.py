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
    send_file, Blueprint
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
app = Flask(
    __name__,
    static_folder="static",
    template_folder="templates"
)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
CORS(app, origins=["https://robostudy.jp"], supports_credentials=True)
limiter = Limiter(app, key_func=get_remote_address, default_limits=["10 per minute"])

# ─── API キー設定 ────────────────────────────────────
openai.api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=openai.api_key)
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

# ─── CameraTest Blueprint 登録 ─────────────────────────
camera_bp = Blueprint(
    "camera_test",
    __name__,
    template_folder="CameraTest/templates",
    static_folder="CameraTest/static",
    static_url_path="/camera-test/static"
)

@camera_bp.route("/")
def camera_index():
    return render_template("index.html")

app.register_blueprint(camera_bp, url_prefix="/camera-test")

# ─── キャッシュ無効化ヘッダー ─────────────────────────
@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ─── SPA Catch-All ルーティング ───────────────────────
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_spa(path):
    static_path = os.path.join(app.static_folder, path)
    if path and os.path.isfile(static_path):
        return send_from_directory(app.static_folder, path)
    return render_template('index.html')

# ─── 既存エンドポイント群 ──────────────────────────────

@app.route("/ja/templates", methods=["GET"])
def get_templates():
    return jsonify([
        {"category": "体調", "caregiver": ["体調はいかがですか？", "痛みはありますか？"], "caree": ["元気です。", "今日は少しだるいです。"]},
        {"category": "食事", "caregiver": ["お食事は何を召し上がりましたか？", "美味しかったですか？"], "caree": ["サンドイッチを食べました。", "まだ食べていません。"]},
        {"category": "薬",   "caregiver": ["お薬は飲みましたか？", "飲み忘れはないですか？"],      "caree": ["飲みました。", "まだです。"]},
        {"category": "睡眠", "caregiver": ["昨夜はよく眠れましたか？", "何時にお休みになりましたか？"], "caree": ["よく眠れました。", "少し寝不足です。"]},
        {"category": "排便", "caregiver": ["お通じはいかがですか？", "問題ありませんか？"],      "caree": ["問題ありません。", "少し便秘気味です。"]}
    ])

@app.route("/ja/chat", methods=["POST"])
def chat_ja():
    data = request.get_json()
    message = data.get("message", "")
    messages = data.get("messages", [])
    try:
        resp = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role":"system","content":"You are a helpful assistant."}]
                     + messages + [{"role":"user","content":message}]
        )
        return jsonify({"response": resp.choices[0].message.content})
    except Exception as e:
        logging.exception("/ja/chat エラー")
        return jsonify({"error": str(e)}), 500

@app.route("/ja/explain", methods=["POST"])
def explain():
    data = request.get_json()
    term = data.get("term", "")
    try:
        msgs = [
            {"role":"system","content":"日本語で30文字以内で簡潔に専門用語を説明してください。"},
            {"role":"user","content":f"{term}とは？"}
        ]
        resp = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=msgs
        )
        return jsonify({"explanation": resp.choices[0].message.content.strip()})
    except Exception as e:
        logging.exception("/ja/explain エラー")
        return jsonify({"error": str(e)}), 500

@app.route("/ja/translate", methods=["POST"])
def translate():
    data = request.get_json()
    text = data.get("text", "")
    direction = data.get("direction", "ja-en")
    prompt = (
        f"次の日本語を英語に翻訳してください:\n\n{text}"
        if direction == "ja-en"
        else f"Translate the following English into Japanese:\n\n{text}"
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role":"user","content":prompt}]
        )
        return jsonify({"translated": resp.choices[0].message.content.strip()})
    except Exception as e:
        logging.exception("/ja/translate エラー")
        return jsonify({"error": str(e)}), 500

@app.route("/ja/save_log", methods=["POST"])
def save_log():
    data = request.get_json()
    log_dir = "logs"
    os.makedirs(log_dir, exist_ok=True)
    ts = datetime.utcnow().strftime("log_%Y%m%d_%H%M%S.txt")
    path = os.path.join(log_dir, ts)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"ユーザー名: {data.get('username','')}\n")
        f.write(f"日時: {data.get('timestamp','')}\n")
        f.write(f"入力: {data.get('input','')}\n")
        f.write(f"返答: {data.get('response','')}\n")
    return jsonify({"status":"success"})

@app.route("/ja/daily_report", methods=["GET"])
def daily_report():
    files = sorted(glob.glob("logs/log_*.txt"))
    if not files:
        return jsonify({"error":"ログがありません"}), 404
    content = open(files[-1], encoding="utf-8").read()
    resp = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role":"system","content":"以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
            {"role":"user","content":content}
        ]
    )
    summary = resp.choices[0].message.content.strip()
    now = datetime.utcnow() + timedelta(hours=9)
    buf = BytesIO((f"日報作成日時: {now:%Y-%m-%d %H:%M}\n" + summary).encode())
    return send_file(buf, as_attachment=True, download_name="daily_report.txt", mimetype="text/plain")

@app.route("/chat", methods=["POST"])
@limiter.limit("3 per 10 seconds")
def chat_tts():
    data = json.loads(request.data)
    text = data.get("text","").strip()
    if len(text) > 100:
        return jsonify({"reply":"メッセージは100文字以内でお願いします。"}), 400

    try:
        gpt = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=[
                {"role":"system","content":"あなたは親切な日本語のアシスタントです。"},
                {"role":"user","content":text}
            ]
        )
        reply = gpt.choices[0].message.content.strip()
        if len(reply) > 200:
            reply = reply[:197] + "..."

        # 音声合成
        tts = texttospeech.TextToSpeechClient()
        audio = tts.synthesize_speech(
            input=texttospeech.SynthesisInput(text=reply),
            voice=texttospeech.VoiceSelectionParams(
                language_code="ja-JP",
                ssml_gender=texttospeech.SsmlVoiceGender.NEUTRAL
            ),
            audio_config=texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
        )
        os.makedirs("static", exist_ok=True)
        with open("static/output.mp3","wb") as f:
            f.write(audio.audio_content)

        # ログ
        with open("chatlog.txt","a",encoding="utf-8") as logf:
            logf.write(f"ユーザー: {text}\nみまくん: {reply}\n---\n")

        return jsonify({"reply":reply})
    except Exception:
        logging.exception("chat_tts error")
        return jsonify({"reply":"内部エラーです。再度お試しください。"}),500

@app.route("/logs")
def logs():
    try:
        text = open("chatlog.txt","r",encoding="utf-8").read()
        return f"<pre>{text}</pre><a href='/download-logs'>ログダウンロード</a>"
    except FileNotFoundError:
        return "ログが存在しません。"

@app.route("/download-logs")
def download_logs():
    return (
        open("chatlog.txt","rb").read(),
        200,
        {"Content-Type":"application/octet-stream",
         "Content-Disposition":'attachment; filename="chatlog.txt"'}
    )

@app.route("/create_invoice", methods=["POST"])
def create_invoice():
    customer = stripe.Customer.create(email="test@example.com", name="テスト顧客")
    stripe.InvoiceItem.create(customer=customer.id, amount=1300, currency="jpy", description="デモ請求")
    invoice = stripe.Invoice.create(customer=customer.id)
    invoice = stripe.Invoice.finalize_invoice(invoice.id)
    return redirect(invoice.hosted_invoice_url)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
