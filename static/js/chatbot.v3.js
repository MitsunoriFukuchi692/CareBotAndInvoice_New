// === chatbot.v3.js (server TTS + mobile unlock + playTTS対応) ===
console.log("[chatbot.v3.js] v=20250903a");

// --- iOS/Android 無音対策：初回タップでオーディオ解錠 & 単一Audio ---
let __audioUnlocked = false;
window.addEventListener("touchstart", () => {
  if (__audioUnlocked) return;
  const a = new Audio();
  a.muted = true;
  a.playsInline = true;
  a.play().catch(() => {}).finally(() => { __audioUnlocked = true; });
}, { once: true });

const __ttsAudio = new Audio();
__ttsAudio.preload = "auto";
__ttsAudio.playsInline = true;

// --- サーバーTTS（/tts -> mp3）---
async function speakViaServer(text, langCode){
  if (!text) return;
  try{
    console.log("[TTS] /tts", { langCode, sample: text.slice(0,30) });
     const res = await fetch("/tts", {
       method: "POST",
       headers: {"Content-Type":"application/json"},
       body: JSON.stringify({
         text,
         lang: langCode,
         volume: (typeof window.getTTSVolume === "function" ? window.getTTSVolume() : 6.0)
    });
    if (!res.ok) throw new Error("TTS failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    // index.html で追加した window.playTTS があれば優先（解錠ボタン連携）
    if (typeof window.playTTS === "function") {
      await window.playTTS(url);
    } else {
      __ttsAudio.src = url;
      __ttsAudio.muted = false;
      await __ttsAudio.play();
    }
    URL.revokeObjectURL(url);
  }catch(e){
    console.error("[speakViaServer] error:", e);
    alert("音声再生に失敗しました。");
  }
}

// ===== ユーティリティ =====
const $ = (sel) => document.querySelector(sel);

// サーバ応答からテキストを安全に取り出す
function pickText(data){
  if (!data) return "";
  if (typeof data === "string") return data;
  return (
    data.text || data.explanation || data.definition || data.summary ||
    data.message || data.result ||
    (Array.isArray(data.choices) && data.choices[0]?.message?.content) || ""
  );
}

// ===== 画面メッセージ（日本語はモバイル時のみサーバーTTSへフォールバック） =====
function speak(text, role){
  if (!text) return;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobile) {
    // モバイルは安定優先：サーバーTTSで読み上げ
    speakViaServer(text, "ja-JP");
    return;
  }

  // PCは軽量なブラウザTTS
  const u = new SpeechSynthesisUtterance(text);
  u.volume = 1.0; u.rate = 1.0; u.lang = "ja-JP";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function appendMessage(role, text){
  const chatWindow = $("#chat-window");
  const div = document.createElement("div");
  div.classList.add("message");
  if (role === "caregiver") div.classList.add("caregiver");
  if (role === "caree")     div.classList.add("caree");
  div.textContent = (role === "caregiver" ? "介護士: " : role === "caree" ? "被介護者: " : "") + text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  speak(text, role); // 日本語読み上げ
}

// ===== テンプレ会話 =====
const caregiverTemplates = {
  "体調": ["今日は元気ですか？","どこか痛いところはありますか？","疲れは残っていますか？","最近の体温はどうですか？"],
  "食事": ["朝ごはんは食べましたか？","食欲はありますか？","最近食べた美味しかったものは？","食事の量は十分でしたか？"],
  "薬":   ["薬はもう飲みましたか？","飲み忘れはありませんか？","薬を飲んで副作用はありますか？","次の薬の時間は覚えていますか？"],
  "睡眠": ["昨夜はよく眠れましたか？","途中で目が覚めましたか？","今は眠気がありますか？","夢を見ましたか？"],
  "排便": ["便通はありましたか？","お腹は痛くないですか？","便の状態は普通でしたか？","最後に排便したのはいつですか？"]
};
const careeResponses = {
  "体調": ["元気です","少し疲れています","腰が痛いです","まあまあです"],
  "食事": ["はい、食べました","食欲はあります","今日はあまり食べていません","まだ食べていません"],
  "薬":   ["はい、飲みました","まだ飲んでいません","飲み忘れました","副作用はありません"],
  "睡眠": ["よく眠れました","途中で目が覚めました","眠気があります","眠れませんでした"],
  "排便": ["普通でした","少し便秘気味です","下痢でした","昨日ありました"]
};

function showTemplates(role, category = null){
  const templateContainer = $("#template-buttons");
  templateContainer.innerHTML = "";
  if (!category){
    const cats = Object.keys(caregiverTemplates);
    templateContainer.className = "template-buttons category";
    cats.forEach(cat => {
      const b = document.createElement("button");
      b.textContent = cat;
      b.addEventListener("click", () => showTemplates("caregiver", cat));
      templateContainer.appendChild(b);
    });
    return;
  }
  let templates = [];
  if (role === "caregiver"){ templates = caregiverTemplates[category]; templateContainer.className = "template-buttons caregiver"; }
  else { templates = careeResponses[category]; templateContainer.className = "template-buttons caree"; }
  templates.forEach(t => {
    const b = document.createElement("button");
    b.textContent = t;
    b.addEventListener("click", () => {
      appendMessage(role, t);
      if (role === "caregiver") showTemplates("caree", category);
      else                       showTemplates("caregiver");
    });
    templateContainer.appendChild(b);
  });
}

// ===== マイク入力 =====
function setupMic(btn, input){
  if (!btn || !input) return;
  btn.addEventListener("click", () => {
    try{
      const rec = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      rec.lang = "ja-JP";
      rec.onresult = e => input.value = e.results[0][0].transcript;
      rec.start();
    }catch(err){
      console.warn("SpeechRecognition not supported or blocked.", err);
      alert("このブラウザでは音声入力が使えない可能性があります。");
    }
  });
}

// ===== 用語説明 =====
async function fetchExplain(term){
  try{
    const res = await fetch("/ja/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term, maxLength: 30 })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok){
      const text = pickText(data);
      if (text) return text;
    }
  }catch(e){}
  try{
    const res = await fetch("/ja/explain", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ term, maxLength: 30 })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok){
      const text = pickText(data);
      if (text) return text;
    }
  }catch(e){}
  try{
    const url = `/ja/explain?term=${encodeURIComponent(term)}&maxLength=30`;
    const res = await fetch(url, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    if (res.ok){
      const text = pickText(data);
      if (text) return text;
    }
  }catch(e){}
  return "";
}

// ===== 翻訳 =====
async function fetchTranslate(text, direction){
  const res = await fetch("/ja/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, direction })
  });
  return res.json();
}

// ===== 会話ログ保存 =====
async function saveLog(){
  const chatWindow = $("#chat-window");
  const log = chatWindow?.innerText?.trim();
  if (!log){ alert("会話がありません"); return; }
  const ts = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const logWithTime = `[${ts}]\n${log}`;
  try{
    const res = await fetch("/ja/save_log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ log: logWithTime })
    });
    const data = await res.json().catch(() => ({}));
    if (data && (data.status === "success" || data.ok)) alert("会話ログを保存しました。");
    else alert("保存に失敗しました。");
  }catch(e){ console.error(e); alert("エラーが発生しました。"); }
}

// ===== エントリーポイント =====
document.addEventListener("DOMContentLoaded", () => {
  console.log("👉 スクリプト開始");

  // 要素
  const caregiverInput = $("#caregiver-input");
  const careeInput = $("#caree-input");
  const caregiverSend = $("#send-caregiver");
  const careeSend = $("#send-caree");
  const explainBtn = $("#explain-btn");
  const translateBtn = $("#translate-btn");
  const saveBtn = $("#save-log-btn");
  const templateStartBtn = $("#template-start-btn");
  const caregiverMic = $("#mic-caregiver");
  const careeMic = $("#mic-caree");

  // 送信ボタン
  caregiverSend?.addEventListener("click", () => {
    const v = caregiverInput?.value?.trim();
    if (v){ appendMessage("caregiver", v); caregiverInput.value = ""; }
  });
  careeSend?.addEventListener("click", () => {
    const v = careeInput?.value?.trim();
    if (v){ appendMessage("caree", v); careeInput.value = ""; }
  });

  // マイク
  setupMic(caregiverMic, caregiverInput);
  setupMic(careeMic, careeInput);

  // 用語説明
  explainBtn?.addEventListener("click", async () => {
    const termInput = $("#term");
    const out = $("#explanation");
    const term = termInput?.value?.trim();
    if (!term){ alert("用語を入力してください"); return; }
    explainBtn.disabled = true;
    out.textContent = "";
    try{
      const text = await fetchExplain(term);
      out.textContent = (text && String(text).trim()) || "(取得できませんでした)";
      if (text) speak(text, "caregiver"); // 日本語読み上げ
    }catch(err){
      console.error("[explain] error:", err);
      alert("用語説明に失敗しました");
    }finally{
      explainBtn.disabled = false;
    }
  });

  // 翻訳（読み上げはサーバーTTS：端末依存なく安定）
  translateBtn?.addEventListener("click", async () => {
    const src = $("#explanation")?.textContent?.trim();
    if (!src){ alert("先に用語説明を入れてください"); return; }
    const direction = $("#translate-direction")?.value || "ja-en";
    try{
      const data = await fetchTranslate(src, direction);
      const translated = data.translated || pickText(data) || "";
      $("#translation-result").textContent = translated || "(翻訳できませんでした)";

      const speakLangMap = { ja: "ja-JP", en: "en-US", vi: "vi-VN", tl: "fil-PH" };
      const targetLang = (direction.split("-")[1] || "en").toLowerCase();
      const langCode = speakLangMap[targetLang] || "en-US";
      await speakViaServer(translated, langCode);
    }catch(err){
      console.error("[translate] error:", err);
      alert("翻訳に失敗しました");
    }
  });

  // 会話ログ保存
  saveBtn?.addEventListener("click", saveLog);

  // テンプレ開始
  templateStartBtn?.addEventListener("click", () => {
    templateStartBtn.style.display = "none";
    showTemplates("caregiver");
  });
});

// ====== 録画 → サーバー保存 → 再生（PC安定版） ======
let mediaRecorder = null;
let recordedChunks = [];

// 録画開始
async function startRecording() {
  recordedChunks = [];
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : (MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm");
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.start();
}

// 録画停止 → アップロード
async function stopAndSaveRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) return reject("not recording");
    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      try {
        const url = await uploadRecordedBlob(blob);
        resolve(url);
      } catch (e) { reject(e); }
    };
    mediaRecorder.stop();
  });
}

// サーバーに送信（/upload_video, フィールド名は "video"）
async function uploadRecordedBlob(blob) {
  const fd = new FormData();
  fd.append("video", blob, "recording.webm");
  const res = await fetch("/upload_video", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok || !data.ok) { console.error("Upload failed:", data); throw new Error(data.error || "upload-failed"); }
  const player = document.getElementById("savedVideo");
  if (player) {
    player.src = data.url;
    player.load();
    try { await player.play(); } catch (_) {}
  }
  return data.url;
}

// 任意：ボタン結線（存在する場合のみ）
document.getElementById("startRecordBtn")?.addEventListener("click", () => {
  startRecording().catch(err => alert("録画開始失敗: " + err));
});
document.getElementById("stopSaveBtn")?.addEventListener("click", async () => {
  try { await stopAndSaveRecording(); alert("保存しました"); }
  catch (e) { alert("保存失敗: " + e.message); }
});
