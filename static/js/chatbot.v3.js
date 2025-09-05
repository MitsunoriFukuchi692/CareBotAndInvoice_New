// === chatbot.v3.js (v=20250904k, server TTS 強化 + fallback) ===
console.log("[chatbot.v3.js] v=20250904k");

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

// --- サーバーTTS（堅牢版） ---
async function speakViaServer(text, langCode){
  if (!text) return;

  // 共通: レスポンス→再生（音声か検査）
  async function playFromResponse(res){
    if (!res.ok) throw new Error("TTS HTTP " + res.status);
    const ct = res.headers.get("Content-Type") || "";
    const blob = await res.blob();

    // 音声でなければ、本文を読んで詳細ログを出す
    if (!ct.startsWith("audio/") && !blob.type.startsWith("audio/")) {
      let msg = "";
      try { msg = await (new Response(blob)).text(); } catch(e){}
      console.warn("[TTS] 非音声レスポンス:", { ct, msg: msg?.slice(0,200) });
      throw new Error("TTS returned non-audio content");
    }

    const url = URL.createObjectURL(blob);
    try{
      if (typeof window.playTTS === "function"){
        await window.playTTS(url);
      } else {
        const a = new Audio(url);
        a.playsInline = true;
        a.muted = false;
        await a.play();
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ① JSON POST
  try{
    const r1 = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ text, lang: langCode })
    });
    await playFromResponse(r1);
    return;
  }catch(e1){ console.warn("[TTS] JSON失敗 → urlencoded へ", e1); }

  // ② x-www-form-urlencoded POST
  try{
    const r2 = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ text, lang: langCode })
    });
    await playFromResponse(r2);
    return;
  }catch(e2){ console.warn("[TTS] urlencoded失敗 → GET へ", e2); }

  // ③ GET（/tts?text=...&lang=...）にフォールバック
  try{
    // 直接 Audio に食わせる（サーバがストリーム返却する実装向け）
    const url = `/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(langCode)}&t=${Date.now()}`;
    const a = new Audio(url);
    a.playsInline = true;
    a.muted = false;
    await a.play(); // ここでCTが非音声だと NotSupportedError → 最後の砦へ
    return;
  }catch(e3){ console.warn("[TTS] GET失敗 → speechSynthesis へ", e3); }

  // ④ 最後の砦：ブラウザTTS
  try{
    const u = new SpeechSynthesisUtterance(text);
    const ok = ["ja-JP","en-US","vi-VN","fil-PH"];
    u.lang = ok.includes(langCode) ? langCode : "en-US";
    u.rate = 1.0; u.volume = 1.0;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }catch(e4){
    console.error("[TTS] すべて失敗", e4);
    alert("音声再生に失敗しました");
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
  if (isMobile) { speakViaServer(text, "ja-JP"); return; }
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
  speak(text, role);
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

// === 往復会話モード: 状態とユーティリティ ===
let dialogue = [];               // {speaker:'A'|'B', text, lang}
let currentSpeaker = 'A';

const elConv   = document.getElementById('convMode');
const elLangA  = document.getElementById('langA');
const elLangB  = document.getElementById('langB');
const elQR     = document.getElementById('quick-replies');
const elAuto   = document.getElementById('autoSuggest');

function otherOf(s){ return s === 'A' ? 'B' : 'A'; }
function langOf(s){ return s === 'A' ? (elLangA?.value || 'ja-JP') : (elLangB?.value || 'en-US'); }
function toShort(lang){ return (lang || '').split('-')[0].toLowerCase(); }

// direction 文字列（/ja/translate 用）を作る
function makeDirection(srcLang, dstLang){
  const m = { 'ja':'ja', 'en':'en', 'vi':'vi', 'fil':'tl', 'tl':'tl' };
  const s = m[toShort(srcLang)] || 'ja';
  const d = m[toShort(dstLang)] || 'en';
  return `${s}-${d}`;
}

async function addTurnAndSpeak(speaker, text){
  const srcLang = langOf(speaker);
  const dstSpeaker = otherOf(speaker);
  const dstLang = langOf(dstSpeaker);

  dialogue.push({ speaker, text, lang: srcLang });

  // 画面に表示（元発話）
  appendMessage(speaker === 'A' ? 'caregiver' : 'caree', text);

  // 翻訳
  const direction = makeDirection(srcLang, dstLang);
  const res = await fetch('/ja/translate', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ text, direction })
  });
  const j = await res.json().catch(()=>({}));
  const translated = (j.translated || j.text || '').trim();

  // 相手側に表示→音声再生
  appendMessage(dstSpeaker === 'A' ? 'caregiver' : 'caree', translated);
  await speakViaServer(translated, dstLang);

  // 次のターンへ & 返答案
  currentSpeaker = dstSpeaker;
  renderQuickReplies(dstSpeaker);
}

async function renderQuickReplies(forSpeaker){
  if (!elQR) return;
  elQR.innerHTML = '';
  let suggestions = [];

  if (elAuto?.checked){
    try{
      const ctx = dialogue.slice(-6);
      const r = await fetch('/ja/suggest', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ dialogue: ctx, target_lang: langOf(forSpeaker), n: 3 })
      });
      const j = await r.json().catch(()=>({}));
      suggestions = j.suggestions || [];
    }catch(e){}
  }
  if (!suggestions.length){
    suggestions = ["はい、わかりました。","もう少し詳しく教えてください。","おすすめはありますか？"];
  }

  suggestions.forEach(s => {
    const b = document.createElement('button');
    b.textContent = s;
    b.className = 'chip';
    b.onclick = () => addTurnAndSpeak(forSpeaker, s);
    elQR.appendChild(b);
  });
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
  caregiverSend?.addEventListener("click", async () => {
    const v = caregiverInput?.value?.trim();
    if (!v) return;
    if (elConv?.checked) {
      await addTurnAndSpeak('A', v);
    } else {
      appendMessage("caregiver", v);
    }
    caregiverInput.value = "";
  });

  careeSend?.addEventListener("click", async () => {
    const v = careeInput?.value?.trim();
    if (!v) return;
    if (elConv?.checked) {
      await addTurnAndSpeak('B', v);
    } else {
      appendMessage("caree", v);
    }
    careeInput.value = "";
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
      if (text) speak(text, "caregiver");
    }catch(err){
      console.error("[explain] error:", err);
      alert("用語説明に失敗しました");
    }finally{
      explainBtn.disabled = false;
    }
  });

  // 翻訳→読み上げ
  translateBtn?.addEventListener("click", async () => {
    const src = $("#explanation")?.textContent?.trim();
    if (!src){ alert("先に用語説明を入れてください"); return; }
    const direction = $("#translate-direction")?.value || "ja-en";
    try{
      const data = await fetchTranslate(src, direction);
      const translated = data.translated || pickText(data) || "";
      $("#translation-result").textContent = translated || "(翻訳できませんでした)";

      const speakLangMap = { ja:"ja-JP", en:"en-US", vi:"vi-VN", tl:"fil-PH", fil:"fil-PH" };
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

  // テンプレ開始（a要素のデフォルト遷移を抑止）
  templateStartBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    templateStartBtn.style.display = "none";
    showTemplates("caregiver");
  });

  // 会話モード切替
  elConv?.addEventListener("change", () => {
    if (elConv.checked) {
      currentSpeaker = 'A';
      renderQuickReplies('A');
    } else {
      elQR && (elQR.innerHTML = "");
    }
  });
});

// ====== 録画 → サーバ保存 → 再生（PC安定版） ======
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

// === robust playTTS override (force-stable) ===
window.playTTS = async function playTTS(srcOrBlob){
  try{
    let src = srcOrBlob;
    if (srcOrBlob instanceof Blob) src = URL.createObjectURL(srcOrBlob);

    let el = document.getElementById('tts-audio');
    if (!el) {
      el = document.createElement('audio');
      el.id = 'tts-audio';
      el.playsInline = true;
      document.body.appendChild(el);
    }
    el.muted = false;
    el.src = (typeof src === 'string' ? src : URL.createObjectURL(src)) +
             (String(src).includes('?') ? '&' : '?') + 't=' + Date.now();

    await el.play();
  } catch (e){
    console.warn('playTTS failed, fallback to raw Audio()', e);
    try{
      const a = new Audio(typeof srcOrBlob === 'string' ? srcOrBlob : URL.createObjectURL(srcOrBlob));
      a.playsInline = true;
      a.muted = false;
      await a.play();
    } catch (ee){
      console.error('Audio fallback failed', ee);
      if (window.__lastTranslatedText) {
        const u = new SpeechSynthesisUtterance(window.__lastTranslatedText);
        u.lang = 'ja-JP'; u.rate = 1.0; u.volume = 1.0;
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      }
    }
  }
};

