# app.py — carebotandinvoice-v2 本番用（重複整理版）
# 右下バッジ用の /version、ヘルス /healthz・/readyz、デバッグ /__test__ も1か所で定義

import os, sys, glob, logging, tempfile, mimetypes, uuid, datetime
from pathlib import Path
from io import BytesIO
from flask import send_file

from flask import Flask, render_template, request, jsonify, send_from_directory, send_file, url_for
from flask_cors import CORS
from PIL import Image
from fpdf import FPDF
from google.cloud import texttospeech
from openai import OpenAI
import httpx
import openai as _o
import io
import json

print("Using GOOGLE_APPLICATION_CREDENTIALS:", os.getenv("GOOGLE_APPLICATION_CREDENTIALS"))

# --------------------------------
# 基本設定
# --------------------------------
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100MB
CORS(app)

# 起動ログ
logging.basicConfig(level=logging.INFO)
logging.info(f"[BOOT] Python={sys.version}")
logging.info(f"[BOOT] httpx={httpx.__version__}")
logging.info(f"[BOOT] openai={_o.__version__}")

# ディレクトリ
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
VIDEO_DIR  = UPLOAD_DIR / "videos"
LOG_DIR    = BASE_DIR / "logs"
for d in (UPLOAD_DIR, VIDEO_DIR, LOG_DIR):
    d.mkdir(parents=True, exist_ok=True)

@app.get("/assist")
def assist_hub():
    return render_template("assist.html")

# APIキーなど
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
client = OpenAI(api_key=OPENAI_API_KEY)
tts_client = texttospeech.TextToSpeechClient()
client_tts = tts_client

# --------------------------------
# /version /healthz /readyz /__test__（ここで一括定義）
# --------------------------------
from flask import jsonify  # 局所import可

STARTED_AT = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
VERSION_INFO = {
    "service": os.getenv("SERVICE_NAME", "carebotandinvoice-v2"),
    "git": (os.getenv("GIT_SHA") or os.getenv("RENDER_GIT_COMMIT", ""))[:7],
    "built": os.getenv("BUILD_TIME", STARTED_AT),
    "env": os.getenv("RENDER_SERVICE_NAME", ""),
}

@app.context_processor
def inject_version_info():
    # index.html から {{ version_info.* }} で参照
    return dict(version_info=VERSION_INFO)

@app.route("/version")
def version():
    return jsonify(VERSION_INFO), 200

@app.route("/healthz")
def healthz():
    return "ok", 200

@app.route("/readyz")
def readyz():
    # 依存先チェックが必要なら required にENV名を列挙
    required = []  # 例: ["SUPABASE_URL", "SUPABASE_KEY"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        return jsonify({"ready": False, "missing_env": missing}), 503
    return jsonify({"ready": True}), 200

@app.route("/__test__")
def __test__():
    return "__test__ ok", 200

@app.get("/translate")
def translate_page():
    return render_template("translate.html")

# --------------------------------
# 共通ユーティリティ
# --------------------------------
def jst_now_str(fmt="%Y-%m-%d %H:%M"):
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime(fmt)

def _safe_list_media(dir_path: Path, exts: set[str]) -> list[str]:
    items = []
    try:
        if not dir_path.exists(): return items
        for p in dir_path.iterdir():
            if p.is_file() and p.suffix.lower() in exts:
                items.append(p.name)
    except Exception as e:
        logging.warning(f"list_media error at {dir_path}: {e}")
    return sorted(items)

# キャッシュ抑止
@app.after_request
def add_header(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

# --------------------------------
# 画面
# --------------------------------
@app.route("/", methods=["GET"])
@app.route("/ja/", methods=["GET"])
def index():
    return render_template("index.html")

@app.get("/camera-test/")
def camera_test():
    return render_template("camera_test.html")

# --------------------------------
# 日報関連
# --------------------------------
@app.get("/daily_report")
def daily_report():
    now = jst_now_str()

    # 会話ログの要約（失敗しても継続）
    text_report = "ログがありません"
    try:
        files = sorted(glob.glob(str(LOG_DIR / "log_*.txt")))
        if files:
            content = open(files[-1], encoding="utf-8").read()
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
                    {"role": "user", "content": content},
                ],
                max_tokens=250,
                temperature=0.2,
            )
            text_report = (resp.choices[0].message.content or "").strip() or text_report
    except Exception as e:
        logging.error(f"要約失敗: {e}")

    img_exts = {".jpg", ".jpeg", ".png"}
    vid_exts = {".webm", ".mp4", ".mov", ".ogg"}
    images = _safe_list_media(UPLOAD_DIR, img_exts)
    videos_root = _safe_list_media(UPLOAD_DIR, vid_exts)
    videos_sub  = _safe_list_media(VIDEO_DIR, vid_exts)
    videos = videos_root + [f"videos/{name}" for name in videos_sub]

    return render_template("daily_report.html",
                           now=now, text_report=text_report,
                           images=images, videos=videos)

@app.get("/generate_report_pdf")
def generate_report_pdf():
    now = jst_now_str()

    # 要約テキスト
    files = sorted(glob.glob(str(LOG_DIR / "log_*.txt")))
    text_report = "ログがありません"
    if files:
        content = open(files[-1], encoding="utf-8").read()
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "以下の対話ログをもとに、本日の介護日報を日本語で短くまとめてください。"},
                    {"role": "user", "content": content},
                ],
                max_tokens=250,
                temperature=0.2,
            )
            text_report = (resp.choices[0].message.content or "").strip() or text_report
        except Exception as e:
            logging.error(f"要約失敗: {e}")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=14)
    pdf.cell(0, 10, "本日の見守りレポート", ln=True, align="C")
    pdf.set_font("Arial", size=10)
    pdf.cell(0, 8, f"作成日時: {now}", ln=True, align="C")

    pdf.set_font("Arial", size=12)
    pdf.multi_cell(0, 8, f"会話日報:\n{text_report}")

    # 最新画像（カラー）
    all_media = os.listdir(UPLOAD_DIR)
    images = [f for f in all_media if f.lower().startswith("image_")]
    if images:
        latest_img = str(UPLOAD_DIR / sorted(images)[-1])
        try:
            img = Image.open(latest_img).convert("RGB")
            w, h = img.size
            max_h = 150  # mm
            scale = max_h / h
            img = img.resize((int(w*scale), int(h*scale)))
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                tmp_jpg = tmp.name
            img.save(tmp_jpg, "JPEG", quality=92)
            y = pdf.get_y() + 6
            pdf.image(tmp_jpg, x=10, y=y, h=max_h)
            os.remove(tmp_jpg)
        except Exception as e:
            logging.warning(f"画像挿入エラー: {e}")

    raw = pdf.output(dest="S")
    pdf_bytes = raw if isinstance(raw, (bytes, bytearray)) else raw.encode("latin-1")
    return (pdf_bytes, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=daily_report.pdf"
    })

# --------------------------------
# 画像→PDF（カラー）
# --------------------------------
@app.post("/photo-to-pdf")
def photo_to_pdf():
    try:
        f = request.files.get("photo")
        if not f:
            return jsonify({"ok": False, "error": "no photo"}), 400

        img = Image.open(f.stream).convert("RGB")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            tmp_path = tmp.name
        img.save(tmp_path, "JPEG", quality=92)

        pdf = FPDF(unit="mm", format="A4")
        pdf.add_page()
        pdf.image(tmp_path, x=10, y=10, w=190)

        raw = pdf.output(dest="S")
        pdf_bytes = raw if isinstance(raw, (bytes, bytearray)) else raw.encode("latin-1")
        os.remove(tmp_path)

        return send_file(BytesIO(pdf_bytes), mimetype="application/pdf",
                         as_attachment=True, download_name="photo.pdf")
    except Exception as e:
        logging.exception(f"/photo-to-pdf error: {e}")
        return jsonify({"ok": False, "error": "pdf-failed"}), 500

# --------------------------------
# 動画アップロード（専用）
# --------------------------------
ALLOWED_VIDEO_EXTS = {".webm", ".mp4", ".ogg", ".mov"}

def _ext_from(mimetype_str, fallback=".webm"):
    ext = mimetypes.guess_extension(mimetype_str or "") or fallback
    return ext.lower()

def _is_allowed_ext(ext):
    return ext.lower() in ALLOWED_VIDEO_EXTS

def _cleanup_old_videos(keep=1):
    files = sorted((p for p in VIDEO_DIR.iterdir() if p.is_file()),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files[keep:]:
        try: p.unlink()
        except Exception: pass

@app.post("/upload_video")
def upload_video():
    if "video" not in request.files:
        return jsonify({"ok": False, "error": "no-file-field"}), 400
    f = request.files["video"]
    if not f or not f.filename.strip():
        return jsonify({"ok": False, "error": "empty-file"}), 400

    name_ext = os.path.splitext(f.filename)[1].lower()
    if not name_ext or not _is_allowed_ext(name_ext):
        name_ext = _ext_from(getattr(f, "mimetype", None), fallback=".webm")
    if not _is_allowed_ext(name_ext):
        return jsonify({"ok": False, "error": "unsupported-ext"}), 400

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    fname = f"{stamp}-{uuid.uuid4().hex}{name_ext}"
    save_path = VIDEO_DIR / fname
    f.save(save_path)

    _cleanup_old_videos(keep=1)
    url = url_for("static", filename=f"uploads/videos/{fname}")
    return jsonify({"ok": True, "url": url, "filename": fname}), 200

# --------------------------------
# 既存：メディアのアップロード（画像/動画 共通API）
# --------------------------------
@app.post("/upload_media")
def upload_media():
    """
    受け取り:
      - media_type: "image" | "video"
      - file: Blob/File
    動画は最新1件だけ保持（旧video_を削除）
    """
    media_type = request.form.get("media_type")
    file = request.files.get("file")
    if not media_type or not file:
        return jsonify({"error": "media_type or file missing"}), 400

    if media_type == "video":
        for f in os.listdir(UPLOAD_DIR):
            if f.startswith("video_"):
                try: (UPLOAD_DIR / f).unlink()
                except Exception as e: logging.warning(f"古い動画削除失敗: {f}, {e}")

    _, ext = os.path.splitext(file.filename or "")
    if not ext:
        ext = ".webm" if media_type == "video" else ".jpg"

    ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"{media_type}_{ts}{ext}"
    save_path = UPLOAD_DIR / filename

    try:
        file.save(save_path)
        return jsonify({"status": "saved", "filename": filename,
                        "url": f"/static/uploads/{filename}"}), 200
    except Exception as e:
        logging.error(f"保存エラー: {e}")
        return jsonify({"error": str(e)}), 500

# --------------------------------
# 用語説明（短文・失敗時も200）
# --------------------------------
@app.post("/ja/explain")
def explain_term():
    try:
        data = request.get_json(silent=True) or {}
        term = (
            request.args.get("term") or request.form.get("term") or data.get("term") or
            request.args.get("word") or request.form.get("word") or data.get("word") or ""
        ).strip()
        max_len = int(
            request.args.get("maxLength") or request.form.get("maxLength") or data.get("maxLength") or 30
        )
        if not term:
            msg = "用語が空です"
            return jsonify({"explanation": msg, "definition": msg}), 400

        prompt = f"以下の用語を高齢者にも分かるように日本語で{max_len}文字以内で説明してください。\n用語: {term}"
        try:
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=120, temperature=0.2, timeout=12,
            )
            text = (resp.choices[0].message.content or "").strip() or f"{term}: かんたんな説明です"
        except Exception as inner:
            logging.warning(f"OpenAI失敗: {inner}")
            text = f"{term}: かんたんな説明です"

        return jsonify({"explanation": text, "definition": text}), 200
    except Exception as e:
        logging.exception(f"/ja/explain error: {e}")
        msg = "説明に失敗しました"
        return jsonify({"explanation": msg, "definition": msg}), 200

# --------------------------------
# 翻訳
# --------------------------------
import re

@app.post("/ja/translate")
def translate_text():
    data = request.get_json(force=True) or {}
    text = (data.get("text") or "").trim() if hasattr(str, "trim") else (data.get("text") or "").strip()
    direction = (data.get("direction") or "ja-en").lower()
    if not text:
        return jsonify({"error":"翻訳するテキストがありません"}), 400

    sys_map = {
        "ja-en":"あなたは厳密な翻訳エンジンです。出力は翻訳文のみ。日本語→英語に翻訳せよ。",
        "en-ja":"あなたは厳密な翻訳エンジンです。出力は翻訳文のみ。英語→日本語に翻訳せよ。",
        "ja-vi":"Bạn là công cụ dịch nghiêm ngặt. Chỉ xuất bản dịch. Dịch Nhật→Việt.",
        "vi-ja":"Bạn là công cụ dịch nghiêm ngặt. Chỉ xuất bản dịch. Dịch Việt→Nhật.",
        "ja-tl":"Ikaw ay mahigpit na tagapagsalin. Ibigay lamang ang salin. Isalin Hapon→Tagalog.",
        "tl-ja":"Ikaw ay mahigpit na tagapagsalin. Ibigay lamang ang salin. Isalin Tagalog→Hapon.",
    }
    if direction not in sys_map:
        return jsonify({"error": f"未対応の翻訳方向: {direction}"}), 400

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role":"system","content":sys_map[direction]},
                  {"role":"user","content":text}],
        temperature=0, max_tokens=256,
    )
    out = (resp.choices[0].message.content or "").strip()
    out = out.strip("`")
    out = re.sub(r'^(英訳|和訳|訳|translation|output)\s*[:：]\s*','', out, flags=re.I)
    out = out.splitlines()[0].strip()
    return jsonify({"translated": out})

# --- context-based short replies ---
THANKS_PAT = re.compile(r"(ありがとうございます|感謝|サンキュー|thank(s| you)?)", re.IGNORECASE)
APOLOGY_PAT = re.compile(r"(すみません|ごめん|sorry)", re.IGNORECASE)
SLOW_PAT = re.compile(r"(ゆっくり|slow(ly)?)", re.IGNORECASE)

def _context_reply(target_lang: str, last_text: str):
    t = last_text or ""
    if THANKS_PAT.search(t):
        return {"en":"You're welcome.","ja":"どういたしまして。","vi":"Không có gì.","tl":"Walang anuman."}.get(target_lang,"どういたしまして。")
    if APOLOGY_PAT.search(t):
        return {"en":"No problem.","ja":"大丈夫ですよ。","vi":"Không sao đâu.","tl":"Walang problema."}.get(target_lang,"大丈夫ですよ。")
    if SLOW_PAT.search(t):
        return {"en":"Sure, I’ll speak more slowly.","ja":"はい、ゆっくり話しますね。","vi":"Vâng, tôi sẽ nói chậm hơn.","tl":"Sige, magsasalita ako nang dahan-dahan."}.get(target_lang,"はい、ゆっくり話しますね。")
    return None

# 言語コード → 言語名（正規化用）
LANG_NAME = {
    "ja": "Japanese",
    "en": "English",
    "vi": "Vietnamese",
    "tl": "Tagalog",
    "fil": "Tagalog",  # 別名を吸収
}

# 返答を必ず target_lang の言語に正規化
def _force_to_lang(text: str, target_lang: str) -> str:
    if not text or not client:
        return text
    try:
        lang_name = LANG_NAME.get(target_lang, target_lang)  # vi→Vietnamese, tl/fil→Tagalog
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.1,
            messages=[
                {
                    "role": "system",
                    "content": f"You output only the normalized {lang_name}. No explanations, no quotes."
                },
                {
                    "role": "user",
                    "content": f"Normalize the following into {lang_name} ONLY:\n\nTEXT:\n{text}"
                },
            ],
        )
        out = (r.choices[0].message.content or "").strip()
        # たまに付く引用符を除去
        if (out.startswith('"') and out.endswith('"')) or (out.startswith('“') and out.endswith('”')):
            out = out[1:-1].strip()
        return out
    except Exception:
        return text

# ===== /ja/suggest（旅行/学習用・ハードBAN付き） =====

# 出力方針（モデル用）
SYSTEM_SUGGEST = """You are a concise, bilingual travel & translation assistant.
Task: Based on the recent dialogue and the requested target language, output either:
- suggestions: 2-5 concise candidate replies the user might tap
- reply: a single best next utterance (for auto-reply)
Rules:
- Be context-aware (travel/tourism in Japan, daily conversation for learners).
- If the user asks for POI, give 1-3 specific options with short reasons (name + area).
- If info is insufficient, ask 1 short clarifying question (NOT generic directions).
- Never output generic direction phrases such as:
  "Please go straight.", "Go straight.", "Turn left/right.",
  "まっすぐ行ってください。", "左/右に曲がってください。"
  Unless the user clearly asks for directions **with origin + destination**.
- Keep each sentence short and natural; avoid over-formality.
- Use the target_lang for output.
Output JSON ONLY: {"suggestions":[...], "reply":"..."}.
"""

def _fallback_suggestions(tlang: str):
    if tlang == "en":
        return ["Could you tell me more?", "Any preferences?", "Would you like nearby options?"]
    if tlang == "vi":
        return ["Bạn có thể nói rõ hơn không?", "Bạn thích điều gì?", "Bạn muốn gợi ý gần đây không?"]
    if tlang in ("tl","fil"):
        return ["Pwede bang dagdagan mo ang detalye?", "Ano ang gusto mo?", "Gusto mo ba ng mga lugar malapit?"]
    return ["もう少し詳しく教えてください。","どんな希望がありますか？","近場のおすすめを出しましょうか？"]

# ハードBAN（方向指示の定型文は物理的に禁止）

BAN_GENERIC = [
  "please go straight.", "go straight.", "please head straight.", "go forward.", "head straight.",
  "turn left.", "turn right.",
  "まっすぐ行ってください。", "まっすぐ進んでください。", "まっすぐ行って", "まっすぐ進んで",
  "左に曲がってください。", "右に曲がってください。"
]
BAN_GENERIC_LC = [s.lower() for s in BAN_GENERIC]
def _is_banned_direction(text: str) -> bool:
    import re as _re
    t = (text or "").strip().lower()
    t = _re.sub(r"\s+", " ", t)
    return any(bp in t for bp in BAN_GENERIC_LC)

@app.post("/ja/suggest")
def ja_suggest():
    data = request.get_json(silent=True) or {}
    dialogue = data.get("dialogue") or []  # [{speaker:'A'|'B', 'text':..., 'lang':'ja-JP'}, ...]
    target_lang_full = (data.get("target_lang") or "ja-JP")
    target_lang = target_lang_full.split("-")[0].lower()  # "ja"/"en"/"vi"/"tl"
    n = max(1, min(int(data.get("n") or 3), 5))
    mode = (data.get("mode") or "suggest").lower()

    ctx = dialogue[-6:]
    last_text = (ctx[-1]["text"] if ctx else "") or ""

    suggestions, reply = [], ""
    try:
        payload = {"target_lang": target_lang, "n": n, "mode": mode, "context": ctx}
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.4,
            response_format={"type":"json_object"},
            messages=[
                {"role":"system","content": SYSTEM_SUGGEST},
                {"role":"user","content": json.dumps(payload, ensure_ascii=False)}
            ],
        )
        obj = json.loads(resp.choices[0].message.content)
        suggestions = (obj.get("suggestions") or [])[:n]
        reply = (obj.get("reply") or "").strip()
    except Exception as e:
        logging.warning("/ja/suggest fallback: %s", e)

    if not suggestions:
        suggestions = _fallback_suggestions(target_lang)
    if not reply and suggestions:
        reply = suggestions[0]

    # --- 最終フィルタ（ここが“返却直前の1行追加”の場所です） ---
    if _is_banned_direction(reply):
        # 文脈ショート応答（thanks/apology/slow）を優先、なければ出発地点の確認に差し替え
        ctx_fix = _context_reply(target_lang, last_text)
        reply = ctx_fix or {
            "en":"Where are you now? (landmark or station name)",
            "ja":"今どこにいますか？（目印や駅名を教えてください）",
            "vi":"Bạn đang ở đâu bây giờ? (mốc hoặc tên ga)",
            "tl":"Nasaan ka ngayon? (landmark o pangalan ng istasyon)"
        }.get(target_lang, "今どこにいますか？")
    suggestions = [s for s in suggestions if not _is_banned_direction(s)] or _fallback_suggestions(target_lang)

# ★ここで言語正規化（ベトナム語固定など）★
    reply = _force_to_lang(reply, target_lang)

    return jsonify({"suggestions": suggestions[:n], "reply": reply})
# ===== /ja/suggest ここまで =====

# --------------------------------
# TTS（Google Text-to-Speech）
# --------------------------------
def _normalize_lang(code: str) -> str:
    if not code: return "ja-JP"
    c = code.strip().lower()
    if c in ("ja", "ja-jp"): return "ja-JP"
    if c in ("en", "en-us"): return "en-US"
    if c in ("vi", "vi-vn"): return "vi-VN"
    if c in ("tl", "tl-ph", "fil", "fil-ph"): return "fil-PH"
    return code

_PREFERRED = {
    "ja-JP": "ja-JP-Neural2-D",
    "en-US": "en-US-Neural2-C",
    "vi-VN": "vi-VN-Wavenet-A",
    "fil-PH": "fil-PH-Wavenet-A",
}

def _synthesize_mp3(tts_client, text: str, lang: str, voice: str|None,
                    rate: float, pitch: float, volume_db: float) -> bytes:
    if not text.strip():
        raise ValueError("text is empty")
    if not voice:
        voice = _PREFERRED.get(lang)

    synthesis_input = texttospeech.SynthesisInput(text=text)
    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate=rate,
        pitch=pitch,
        volume_gain_db=volume_db,
    )
    try:
        voice_sel = texttospeech.VoiceSelectionParams(language_code=lang, name=voice)
        resp = tts_client.synthesize_speech(
            input=synthesis_input, voice=voice_sel, audio_config=audio_config
        )
    except Exception:
        voice_sel = texttospeech.VoiceSelectionParams(language_code=lang)
        resp = tts_client.synthesize_speech(
            input=synthesis_input, voice=voice_sel, audio_config=audio_config
        )
    return resp.audio_content

@app.route("/tts", methods=["POST", "GET", "OPTIONS"])
def tts():
    if request.method == "OPTIONS":
        return ("", 204)

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        text  = (data.get("text") or "").strip()
        lang  = _normalize_lang(data.get("lang") or "ja-JP")
        voice = data.get("voice")
        rate  = float(data.get("rate", 1.0))
        pitch = float(data.get("pitch", 0.0))
        vol   = float(data.get("volume", 6.0))
    else:
        text  = (request.args.get("text") or "").strip()
        lang  = _normalize_lang(request.args.get("lang") or "ja-JP")
        voice = request.args.get("voice")
        rate  = float(request.args.get("rate", 1.0))
        pitch = float(request.args.get("pitch", 0.0))
        vol   = float(request.args.get("volume", 6.0))

    if not text:
        return jsonify({"error": "読み上げるテキストがありません"}), 400

    try:
        audio = _synthesize_mp3(tts_client, text, lang, voice, rate, pitch, vol)
        return (audio, 200, {
            "Content-Type": "audio/mpeg",
            "Content-Disposition": 'inline; filename="tts.mp3"',
            "Cache-Control": "no-store",
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
        })
    except Exception as e:
        logging.exception("TTSエラー")
        return jsonify({"error": f"TTSに失敗しました: {e}"}), 500

# --------------------------------
# 配信とユーティリティ
# --------------------------------
@app.get("/uploads/<path:filename>")
def serve_uploads(filename):
    return send_from_directory(UPLOAD_DIR, filename)

@app.get("/test-pdf")
def test_pdf():
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=16)
    pdf.cell(0, 10, "PDF OK", ln=True)
    raw = pdf.output(dest="S")
    data = raw if isinstance(raw, (bytes, bytearray)) else raw.encode("latin-1")
    return (data, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=test.pdf"
    })

@app.post("/ja/save_log")
def save_log():
    data = request.get_json(silent=True) or {}
    log_text = (data.get("log") or "").strip()
    if not log_text:
        return jsonify({"ok": False, "error": "empty-log"}), 400
    ts = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime("%Y%m%d_%H%M%S")
    path = LOG_DIR / f"log_{ts}.txt"
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(log_text)
        return jsonify({"ok": True, "status": "success"})
    except Exception as e:
        logging.error(f"save_log error: {e}")
        return jsonify({"ok": False, "error": "write-failed"}), 500

@app.post("/stt")
def stt_transcribe():
    try:
        f = request.files.get("audio")
        if not f:
            return jsonify({"error": "audioがありません"}), 400
        bio = io.BytesIO(f.read())
        bio.name = f.filename or "audio.webm"  # SDKが拡張子を使うことがあるため

        # OpenAI Whisper で文字起こし
        tr = client.audio.transcriptions.create(
            model="whisper-1",
            file=bio
        )
        # SDK仕様差異を吸収
        text = getattr(tr, "text", None)
        if text is None and isinstance(tr, dict):
            text = tr.get("text", "")
        return jsonify({"text": (text or "").strip()}), 200
    except Exception:
        logging.exception("stt error")
        return jsonify({"error": "STTに失敗しました"}), 500

# --------------------------------
# エントリポイント
# --------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
