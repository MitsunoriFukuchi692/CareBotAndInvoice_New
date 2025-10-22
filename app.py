import os
from flask import Flask, render_template, request, jsonify
from openai import OpenAI
import requests
import httpx  # タイムアウト用

# ▼ static フォルダを明示的に指定
app = Flask(__name__, static_folder="static", template_folder="templates")

# ▼ 一時デバッグ: static/js の中身一覧
@app.route("/__debug/static-js")
def _debug_static_js():
    root = os.path.join(app.static_folder, "js")
    exists = os.path.isdir(root)
    files = sorted(os.listdir(root)) if exists else []
    return jsonify({
        "cwd": os.getcwd(),
        "app.static_folder": app.static_folder,
        "exists(static/js)": exists,
        "files(static/js)": files
    })

# ====== 環境変数チェック ======
def require_env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(f"{name} is not set")
    return v

SUPABASE_URL = require_env("SUPABASE_URL")
SUPABASE_KEY = require_env("SUPABASE_KEY")
SUPABASE_TABLE = "histories"
SUPABASE_REST = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}"
SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

# ====== OpenAIクライアント（1回だけ初期化） ======
OPENAI_API_KEY = require_env("OPENAI_API_KEY")
client = OpenAI(
    api_key=OPENAI_API_KEY,
    http_client=httpx.Client(timeout=30)
)
MODEL = "gpt-4o-mini"  # モデルはここで一元管理

app = Flask(__name__)

# ====== フロントページ ======
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/jibunshi")
def jibunshi():
    return render_template("index.html")

# ====== 文章生成（事実は変えず整えるだけ） ======
@app.route("/generate", methods=["POST"])
def generate():
    try:
        data = request.get_json()
        prompt = data.get("prompt", "").strip()
        if not prompt:
            return jsonify({"error": "プロンプトが空です"}), 400

        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "あなたは自分史のライティングアシスタントです。"
                        "ユーザーの文章を文法や言い回しを整えるだけで改善します。"
                        "事実の追加・想像・創作は禁止です。ユーザーが書いていないことは書かないでください。"
                    ),
                },
                {
                    "role": "user",
                    "content": f"以下の文章を整えてください。事実は変えずに、きれいな日本語にしてください：\n{prompt}"
                },
            ],
            max_tokens=800,
            temperature=0.2,  # ← 創作を抑える設定
        )

        output_text = response.choices[0].message.content.strip()
        return jsonify({"text": output_text})

    except Exception as e:
        print("Error in /generate:", e)
        return jsonify({"error": str(e)}), 500

# ====== 履歴保存 ======
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

# ====== 履歴取得 ======
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

# ====== Render用 ======
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
