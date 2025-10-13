import os
from flask import Flask, render_template, request, jsonify
from openai import OpenAI

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

# --- Renderなどで必要 ---
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
