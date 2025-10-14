import os
from flask import Flask, render_template, request, jsonify
from openai import OpenAI
import requests, os

SUPABASE_URL = os.getenv("SUPABASE_URL")          # 例: https://bqrscgzkpeuaakpnmrwv.supabase.co
SUPABASE_KEY = os.getenv("SUPABASE_KEY")          # anon もしくは publishable
SUPABASE_TABLE = "histories"
SUPABASE_REST = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}"
SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# --- OpenAIクライアント ---
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

app = Flask(__name__)

# --- フロントページ ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/jibunshi")
def jibunshi():
    return render_template("index.html")

# --- /generate エンドポイント ---
@app.route("/generate", methods=["POST"])
def generate():
    try:
        data = request.get_json()
        prompt = data.get("prompt", "").strip()

        if not prompt:
            return jsonify({"error": "プロンプトが空です"}), 400

        # OpenAI API呼び出し
        response = client.chat.completions.create(
            model="gpt-4o-mini",   # 軽くて高速
            messages=[
                {"role": "system", "content": "あなたは聞き手となって、温かく丁寧な日本語で自分史の文章を整えるAIです。"},
                {"role": "user", "content": prompt}
            ],
            max_tokens=800,
            temperature=0.8,
        )

        output_text = response.choices[0].message.content.strip()
        return jsonify({"text": output_text})

    except Exception as e:
        print("Error in /generate:", e)
        return jsonify({"error": str(e)}), 500

# ② ← これを /generate の下あたりに追加
@app.route("/save", methods=["POST"])
def save_history():
    try:
        data = request.get_json(silent=True) or {}
        payload = {
            "user_name": data.get("user_name", "guest"),
            "prompt": data.get("prompt", ""),
            "response": data.get("response", "")
        }
        r = requests.post(SUPABASE_REST, headers=SUPABASE_HEADERS, json=payload, timeout=10)
        if r.status_code in (200, 201):
            return jsonify({"status": "ok", "data": r.json()})
        return jsonify({"status": "error", "detail": r.text}), r.status_code
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 500


@app.route("/get", methods=["GET"])
def get_histories():
    try:
        params = {"select": "*", "order": "created_at.desc", "limit": 20}
        r = requests.get(SUPABASE_REST, headers=SUPABASE_HEADERS, params=params, timeout=10)
        if r.ok:
            return jsonify({"status": "ok", "data": r.json()})
        return jsonify({"status": "error", "detail": r.text}), r.status_code
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 500

# --- Renderなどで必要 ---
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
