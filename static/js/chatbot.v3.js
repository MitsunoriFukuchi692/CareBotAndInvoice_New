// === chatbot.v3.js (clean 完全版) ===
console.log("[chatbot.v3.js] cleaned for single TTS flow");

// --- iOS/Android 無音対策 ---
let __audioUnlocked = false;
window.addEventListener("touchstart", () => {
  if (__audioUnlocked) return;
  const a = new Audio();
  a.muted = true;
  a.playsInline = true;
  a.play().catch(() => {}).finally(() => { __audioUnlocked = true; });
}, { once: true });

// --- サーバーTTS（堅牢版） ---
// --- サーバーTTS（GET→blob→ObjectURL 専用） ---
async function speakViaServer(text, langCode){
  if (!text) return;

  // 端末の無音制限の事前解除（失敗しても続行）
  try{
    if (!window.__audioUnlocked){
      const a = new Audio();
      a.muted = true;
      a.playsInline = true;
      await a.play().catch(()=>{});
      window.__audioUnlocked = true;
    }
  }catch(e){/* ignore */}

  const url = `/tts?text=${encodeURIComponent(text)}&lang=${encodeURIComponent(langCode)}&t=${Date.now()}`;
  console.log("[TTS][GET→blob] url=", url);

  try{
    const res = await fetch(url, { method:"GET", cache:"no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);

    // audio判定（ヘッダ or blob.type）
    const ct = (res.headers.get("Content-Type") || "").toLowerCase();
    const blob = await res.blob();

    if (!(ct.startsWith("audio/") || blob.type.startsWith("audio/"))) {
      let msg = ""; try{ msg = await (new Response(blob)).text(); }catch(_){}
      console.error("[TTS] 非音声レスポンス", { ct, msg: msg.slice(0,200) });
      alert("音声の取得に失敗しました。Network→/tts の Response を確認してください。");
      return;
    }

    const objUrl = URL.createObjectURL(blob);
    try{
      const audio = new Audio(objUrl);
      audio.playsInline = true;
      audio.muted = false;
      await audio.play();
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  }catch(e){
    console.error("[TTS] 再生失敗", e);
    alert("音声の再生に失敗しました（Console参照）");
  }
}

// ===== ユーティリティ =====
const $ = (sel) => document.querySelector(sel);
function pickText(data){
  if (!data) return "";
  if (typeof data === "string") return data;
  return (
    data.text || data.explanation || data.definition || data.summary ||
    data.message || data.result ||
    (Array.isArray(data.choices) && data.choices[0]?.message?.content) || ""
  );
}

// ===== メッセージ表示 =====
function speak(text, role){
  if (!text) return;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) { speakViaServer(text, "ja-JP"); return; }
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
      console.warn("SpeechRecognition not supported.", err);
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

// ===== エントリーポイント =====
document.addEventListener("DOMContentLoaded", () => {
  console.log("👉 スクリプト開始");

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

  caregiverSend?.addEventListener("click", async () => {
    const v = caregiverInput?.value?.trim();
    if (!v) return;
    appendMessage("caregiver", v);
    caregiverInput.value = "";
  });
  careeSend?.addEventListener("click", async () => {
    const v = careeInput?.value?.trim();
    if (!v) return;
    appendMessage("caree", v);
    careeInput.value = "";
  });

  setupMic(caregiverMic, caregiverInput);
  setupMic(careeMic, careeInput);

  explainBtn?.addEventListener("click", async () => {
    const term = $("#term")?.value?.trim();
    const out = $("#explanation");
    if (!term){ alert("用語を入力してください"); return; }
    explainBtn.disabled = true;
    out.textContent = "";
    try{
      const text = await fetchExplain(term);
      out.textContent = (text && String(text).trim()) || "(取得できませんでした)";
      if (text) speak(text, "caregiver");
    }finally{
      explainBtn.disabled = false;
    }
  });

  // 翻訳→表示→TTS 再生（ここを丸ごと置換）
translateBtn?.addEventListener("click", async () => {
  const src = $("#explanation")?.textContent?.trim();
  if (!src){ alert("先に用語説明を入れてください"); return; }

  const direction = $("#translate-direction")?.value || "ja-en";
  try{
    const data = await fetchTranslate(src, direction);
    const translated = data.translated || data.dst_text || pickText(data) || "";
    $("#translation-result").textContent = translated || "(翻訳できませんでした)";

    // 翻訳完了後に必ずTTSを起動（GET→blob 再生）
    const target = (direction.split("-")[1] || "en").toLowerCase();
    const speakLangMap = { ja:"ja-JP", en:"en-US", vi:"vi-VN", tl:"fil-PH", fil:"fil-PH" };
    const langCode = speakLangMap[target] || "en-US";
    await speakViaServer(translated, langCode);
  }catch(err){
    console.error("[translate] error:", err);
    alert("翻訳に失敗しました");
  }
});

  saveBtn?.addEventListener("click", () => { /* 未実装 */ });
  templateStartBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  window.startTemplates();
});
});

// ==== パッチから呼び出せる startTemplates 関数 ====
window.startTemplates = function(){
  const btn = document.getElementById("template-start-btn");
  if (btn) btn.style.display = "none";
  showTemplates("caregiver");
};

// ==== どこからでも呼べる onTTS（クリックパッチ用） ====
window.onTTS = async function(){
  // 直近の翻訳結果を取得
  const text = document.querySelector("#translation-result")?.textContent?.trim();
  if (!text){ alert("先に翻訳してください"); return; }

  // UIの言語方向から再生言語を決定
  const dir = document.querySelector("#translate-direction")?.value || "ja-en";
  const targetLang = (dir.split("-")[1] || "en").toLowerCase();
  const speakLangMap = { ja:"ja-JP", en:"en-US", vi:"vi-VN", tl:"fil-PH", fil:"fil-PH" };
  const langCode = speakLangMap[targetLang] || "en-US";

  console.log("[TTS] play:", { text: text.slice(0,60), langCode });
  await speakViaServer(text, langCode);
};
