import os
import json
import logging
from flask import Flask, render_template, request, jsonify, redirect, send_from_directory
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from google.cloud import texttospeech
import openai
import stripe

# ログ設定
logging.basicConfig(level=logging.DEBUG)

# Flask アプリ初期化
app = Flask(__name__)
CORS(app, origins=["https://robostudy.jp"])
limiter = Limiter(app, key_func=get_remote_address, default_limits=["10 per minute"])

# 環境変数から各種キーを読み込む
openai.api_key = os.getenv("OPENAI_API_KEY")
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

# ルート：トップページ（index.html）を返す
@app.route("/")
def index():
    return send_from_directory(".", "index.html")

# 既存チャットボット用エンドポイント
@app.route("/chat", methods=["POST"])
@limiter.limit("3 per 10 seconds")
def chat():
    try:
        data = json.loads(request.data)
        user_text = data.get("text", "").strip()
        if len(user_text) > 100:
            return jsonify({"reply": "みまくん: メッセージは100文字以内でお願いします。"}), 400

        # ChatGPT へ送信
        response = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "あなたは親切な日本語のアシスタントです。"},
                {"role": "user",   "content": user_text}
            ]
        )
        reply_text = response.choices[0].message["content"].strip()
        if len(reply_text) > 200:
            reply_text = reply_text[:197] + "..."

        # TTS 合成
        tts_client = texttospeech.TextToSpeechClient()
        synthesis_input = texttospeech.SynthesisInput(text=reply_text)
        voice = texttospeech.VoiceSelectionParams(
            language_code="ja-JP",
            ssml_gender=texttospeech.SsmlVoiceGender.NEUTRAL
        )
        audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
        tts_response = tts_client.synthesize_speech(
            input=synthesis_input, voice=voice, audio_config=audio_config
        )

        # 音声ファイル保存
        os.makedirs("static", exist_ok=True)
        with open("static/output.mp3", "wb") as out:
            out.write(tts_response.audio_content)

        # ログ保存
        with open("chatlog.txt", "a", encoding="utf-8") as f:
            f.write(f"ユーザー: {user_text}\nみまくん: {reply_text}\n---\n")

        return jsonify({"reply": reply_text})

    except Exception:
        logging.exception("/chat エラー")
        return jsonify({"reply": "みまくん: 内部エラーです。再度お試しください。"}), 500

# 会話ログ表示・ダウンロード
@app.route("/logs")
def logs():
    try:
        with open("chatlog.txt", "r", encoding="utf-8") as f:
            content = f.read()
        return f"<pre>{content}</pre><a href='/download-logs'>ログダウンロード</a>"
    except FileNotFoundError:
        return "ログが存在しません。"

@app.route("/download-logs")
def download_logs():
    return (
        open("chatlog.txt", "rb").read(),
        200,
        {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": 'attachment; filename="chatlog.txt"',
        },
    )

# ——— 追加機能：インボイス発行 ———
@app.route("/create_invoice", methods=["POST"])
def create_invoice():
    # 1) 顧客を作成
    customer = stripe.Customer.create(
        email="test@example.com",
        name="テスト顧客"
    )
    # 2) 請求アイテムを登録（¥1,300）
    stripe.InvoiceItem.create(
        customer=customer.id,
        amount=1300,
        currency="jpy",
        description="デモ請求"
    )
    # 3) インボイスを作成＆確定
    invoice = stripe.Invoice.create(customer=customer.id)
    invoice = stripe.Invoice.finalize_invoice(invoice.id)
    # 4) 支払いページへリダイレクト
    return redirect(invoice.hosted_invoice_url)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
import os
import glob
from io import BytesIO
from flask import Flask, request, jsonify, render_template, send_file
from flask_cors import CORS
from openai import OpenAI
from datetime import datetime, timedelta

app = Flask(__name__, static_folder="static")
# キャッシュ無効化設定
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
CORS(app)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.route("/")
@app.route("/ja/")
def index():
    return render_template("index.html")

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
def chat():
    data = request.get_json()
    message = data.get("message", "")
    messages = data.get("messages", [])
    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "system", "content": "You are a helpful assistant."}] + messages + [{"role": "user", "content": message}]
        )
        return jsonify({"response": response.choices[0].message.content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/ja/explain", methods=["POST"])
def explain():
    data = request.get_json()
    term = data.get("term", "")
    try:
        msgs = [
            {"role": "system", "content": "日本語で30文字以内で簡潔に専門用語を説明してください。"},
            {"role": "user",   "content": term + "とは？"}
        ]
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=msgs
        )
        explanation = response.choices[0].message.content.strip()
        return jsonify({"explanation": explanation})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/ja/translate", methods=["POST"])
def translate():
    data = request.get_json()
    text = data.get("text", "")
    direction = data.get("direction", "ja-en")
    if direction == "ja-en":
        prompt = f"次の日本語を英語に翻訳してください:\n\n{text}"
    else:
        prompt = f"Translate the following English into Japanese:\n\n{text}"
    try:
        resp = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}]
        )
        translated = resp.choices[0].message.content.strip()
        return jsonify({"translated": translated})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/ja/save_log", methods=["POST"])
def save_log():
    data = request.get_json()
    log_dir = "logs"
    os.makedirs(log_dir, exist_ok=True)
    now_ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    file_path = os.path.join(log_dir, f"log_{now_ts}.txt")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("ユーザー名: " + data.get('username', '') + "\n")
        f.write("日時: " + data.get('timestamp', '') + "\n")
        f.write("入力: " + data.get('input', '') + "\n")
        f.write("返答: " + data.get('response', '') + "\n")
    return jsonify({"status": "success"})

@app.route("/ja/daily_report", methods=["GET"])
def daily_report():
    log_files = sorted(glob.glob("logs/log_*.txt"))
    if not log_files:
        return jsonify({"error": "ログがありません"}), 404
    latest = log_files[-1]
    with open(latest, encoding="utf-8") as f:
        content = f.read()
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
            {"role": "user",   "content": content}
        ]
    )
    # JST日時取得
    jst_now = datetime.utcnow() + timedelta(hours=9)
    now_str = jst_now.strftime("%Y-%m-%d %H:%M")
    summary_body = response.choices[0].message.content.strip()
    summary = "日報作成日時: " + now_str + "\n" + summary_body
    buf = BytesIO(summary.encode("utf-8"))
    return send_file(buf, as_attachment=True, download_name="daily_report.txt", mimetype="text/plain")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
import os
import glob
from io import BytesIO
from flask import Flask, request, jsonify, render_template, send_file
from flask_cors import CORS
from openai import OpenAI
from datetime import datetime, timedelta
import stripe

app = Flask(__name__, static_folder="static")
# キャッシュ無効化設定
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
CORS(app)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# Stripe APIキー読み込み
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# トップページ（チャット＋インボイス統合版）
@app.route("/")
def index():
    return render_template("index.html")

# テンプレート取得
@app.route("/ja/templates", methods=["GET"])
def get_templates():
    return jsonify([
        {"category": "体調", "caregiver": ["体調はいかがですか？", "痛みはありますか？"], "caree": ["元気です。", "今日は少しだるいです。"]},
        {"category": "食事", "caregiver": ["お食事は何を召し上がりましたか？", "美味しかったですか？"], "caree": ["サンドイッチを食べました。", "まだ食べていません。"]},
        {"category": "薬",   "caregiver": ["お薬は飲みましたか？", "飲み忘れはないですか？"],      "caree": ["飲みました。", "まだです。"]},
        {"category": "睡眠", "caregiver": ["昨夜はよく眠れましたか？", "何時にお休みになりましたか？"], "caree": ["よく眠れました。", "少し寝不足です。"]},
        {"category": "排便", "caregiver": ["お通じはいかがですか？", "問題ありませんか？"],      "caree": ["問題ありません。", "少し便秘気味です。"]}
    ])

# チャット
@app.route("/ja/chat", methods=["POST"])
def chat():
    data = request.get_json()
    message = data.get("message", "")
    messages = data.get("messages", [])
    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "system", "content": "You are a helpful assistant."}] + messages + [{"role": "user", "content": message}]
        )
        return jsonify({"response": response.choices[0].message.content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 用語説明
@app.route("/ja/explain", methods=["POST"])
def explain():
    data = request.get_json()
    term = data.get("term", "")
    try:
        msgs = [
            {"role": "system", "content": "日本語で30文字以内で簡潔に専門用語を説明してください。"},
            {"role": "user",   "content": term + "とは？"}
        ]
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=msgs
        )
        explanation = response.choices[0].message.content.strip()
        return jsonify({"explanation": explanation})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 翻訳
@app.route("/ja/translate", methods=["POST"])
def translate():
    data = request.get_json()
    text = data.get("text", "")
    direction = data.get("direction", "ja-en")
    if direction == "ja-en":
        prompt = f"次の日本語を英語に翻訳してください:\n\n{text}"
    else:
        prompt = f"Translate the following English into Japanese:\n\n{text}"
    try:
        resp = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}]
        )
        translated = resp.choices[0].message.content.strip()
        return jsonify({"translated": translated})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ログ保存
@app.route("/ja/save_log", methods=["POST"])
def save_log():
    data = request.get_json()
    log_dir = "logs"
    os.makedirs(log_dir, exist_ok=True)
    now_ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    file_path = os.path.join(log_dir, f"log_{now_ts}.txt")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("ユーザー名: " + data.get('username', '') + "\n")
        f.write("日時: " + data.get('timestamp', '') + "\n")
        f.write("入力: " + data.get('input', '') + "\n")
        f.write("返答: " + data.get('response', '') + "\n")
    return jsonify({"status": "success"})

# 日報作成
@app.route("/ja/daily_report", methods=["GET"])
def daily_report():
    log_files = sorted(glob.glob("logs/log_*.txt"))
    if not log_files:
        return jsonify({"error": "ログがありません"}), 404
    latest = log_files[-1]
    with open(latest, encoding="utf-8") as f:
        content = f.read()
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
            {"role": "user",   "content": content}
        ]
    )
    jst_now = datetime.utcnow() + timedelta(hours=9)
    now_str = jst_now.strftime("%Y-%m-%d %H:%M")
    summary_body = response.choices[0].message.content.strip()
    summary = "日報作成日時: " + now_str + "\n" + summary_body
    buf = BytesIO(summary.encode("utf-8"))
    return send_file(buf, as_attachment=True, download_name="daily_report.txt", mimetype="text/plain")

# — 追加: インボイス発行 —
@app.route("/create_invoice", methods=["POST"])
def create_invoice():
    # 顧客作成
    customer = stripe.Customer.create(email="test@example.com", name="テスト顧客")
    # 請求アイテム登録
    stripe.InvoiceItem.create(customer=customer.id, amount=1300, currency='jpy', description='デモ請求')
    # インボイス作成・確定
    invoice = stripe.Invoice.create(customer=customer.id)
    invoice = stripe.Invoice.finalize_invoice(invoice.id)
    # 支払いページにリダイレクト
    return redirect(invoice.hosted_invoice_url)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)