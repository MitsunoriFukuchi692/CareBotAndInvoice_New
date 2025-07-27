from flask import Flask, render_template

app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/static"
)

@app.route("/")
def index():
    return render_template("index.html")

if __name__ == "__main__":
    # 開発用は debug=True でもOK。公開時は外してください。
    app.run(host="0.0.0.0", port=5000, debug=True)
