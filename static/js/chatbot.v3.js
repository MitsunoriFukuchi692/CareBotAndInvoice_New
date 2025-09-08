// === chatbot.v3.js (fixed) ===
// A/B往復会話・テンプレ・用語説明対応。翻訳は毎回 src/dst を明示送信。

console.log("[chatbot.v3.js] fixed: explicit src/dst, correct TTS lang");

// --- iOS/Android 無音対策 ---
let __audioUnlocked = false;
window.addEventListener(
  "touchstart",
  () => {
    if (__audioUnlocked) return;
    const a = new Audio();
    a.muted = true;
    a.playsInline = true;
    a.play().catch(() => {}).finally(() => { __audioUnlocked = true; });
  },
  { once: true }
);

// --- サーバーTTS（単発再生） ---
async function speakViaServer(text, langCode) {
  if (!text) return;
  async function playFromResponse(res) {
    if (!res.ok) throw new Error("TTS HTTP " + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      const a = new Audio(url);
      a.playsInline = true;
      a.muted = false;
      await a.play();
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  try {
    const r1 = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang: langCode })
    });
    await playFromResponse(r1);
    return;
  } catch (e1) {
    // fallback: ブラウザTTS
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langCode || "ja-JP";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}

// ===== ユーティリティ =====
const $ = (sel) => document.querySelector(sel);
function pickText(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  return (
    data.dst_text || data.translated || data.text || data.explanation || data.definition || data.summary ||
    data.message || data.result ||
    (Array.isArray(data.choices) && data.choices[0]?.message?.content) || ""
  );
}

// ----- 言語コード変換 -----
function toShort(lang) { return (lang || "").split("-")[0].toLowerCase(); }
// UIの#langA/#langB は BCP-47 を想定 → 翻訳APIは短縮コードで送る
const shortMap = { ja: "ja", en: "en", vi: "vi", fil: "tl", tl: "tl" };
const bcpMap   = { ja: "ja-JP", en: "en-US", vi: "vi-VN", tl: "fil-PH", fil: "fil-PH" };

function getPairFromUI(speaker){
  const src = speaker === "A" ? ($("#langA")?.value || "ja-JP") : ($("#langB")?.value || "en-US");
  const dst = speaker === "A" ? ($("#langB")?.value || "en-US") : ($("#langA")?.value || "ja-JP");
  const srcShort = shortMap[toShort(src)] || "ja";
  const dstShort = shortMap[toShort(dst)] || "en";
  const dstBCP   = bcpMap[dstShort] || "en-US";
  return { src, dst, srcShort, dstShort, dstBCP };
}

// ===== メッセージ表示（表示のみ。自動TTSはしない） =====
function appendMessage(role, text){
  const chatWindow = $("#chat-window");
  const div = document.createElement("div");
  div.classList.add("message");
  if (role === "caregiver") div.classList.add("caregiver");
  if (role === "caree")     div.classList.add("caree");
  div.textContent = (role === "caregiver" ? "介護士: " : "被介護者: ") + text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
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
      alert("音声入力が使えません");
    }
  });
}

// ===== 用語説明 =====
async function fetchExplain(term){
  const res = await fetch("/ja/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ term, maxLength: 30 })
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? pickText(data) : "";
}

// ===== 翻訳 =====
async function apiTranslate({ text, srcShort, dstShort }){
  const res = await fetch("/ja/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, src: srcShort, dst: dstShort })
  });
  return res.json();
}

// ===== A/B往復会話 =====
let currentSpeaker = "A";
function otherOf(s){ return s === "A" ? "B" : "A"; }

async function addTurnAndSpeak(speaker, text){
  const { srcShort, dstShort, dstBCP } = getPairFromUI(speaker);

  // 入力者の原文を表示
  appendMessage(speaker === "A" ? "caregiver" : "caree", text);

  // 翻訳（src/dst を毎回明示）
  const j = await apiTranslate({ text, srcShort, dstShort }).catch(()=>({}));
  const translated = (j.dst_text || j.translated || j.text || "").trim();

  // 相手側に訳文を表示
  const dstRole = otherOf(speaker) === "A" ? "caregiver" : "caree";
  appendMessage(dstRole, translated || "(翻訳できませんでした)");

  // 音声は必ず dst 言語で
  if (translated) await speakViaServer(translated, bcpMap[dstShort] || dstBCP);

  currentSpeaker = otherOf(speaker);
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
  const templateStartBtn = $("#template-start-btn");
  const caregiverMic = $("#mic-caregiver");
  const careeMic = $("#mic-caree");

  caregiverSend?.addEventListener("click", async () => {
    const v = caregiverInput?.value?.trim();
    if (!v) return;
    if ($("#convMode")?.checked) { await addTurnAndSpeak("A", v); }
    else { appendMessage("caregiver", v); }
    caregiverInput.value = "";
  });

  careeSend?.addEventListener("click", async () => {
    const v = careeInput?.value?.trim();
    if (!v) return;
    if ($("#convMode")?.checked) { await addTurnAndSpeak("B", v); }
    else { appendMessage("caree", v); }
    careeInput.value = "";
  });

  setupMic(caregiverMic, caregiverInput);
  setupMic(careeMic, careeInput);

  // 用語説明 → 読み上げ
  explainBtn?.addEventListener("click", async () => {
    const term = $("#term")?.value?.trim();
    const out = $("#explanation");
    if (!term){ alert("用語を入力してください"); return; }
    explainBtn.disabled = true;
    out.textContent = "";
    try{
      const text = await fetchExplain(term);
      out.textContent = text || "(取得できませんでした)";
      if (text) await speakViaServer(text, "ja-JP");
    }finally{ explainBtn.disabled = false; }
  });

  // 単発翻訳ボタン（src/dstを明示）
  translateBtn?.addEventListener("click", async () => {
    const srcText = $("#explanation")?.textContent?.trim();
    if (!srcText){ alert("先に用語説明を入れてください"); return; }
    const sel = ($("#translate-direction")?.value || "ja-en").toLowerCase();
    const [s, d] = sel.split("-"); // "ja-en"
    try{
      const data = await apiTranslate({ text: srcText, srcShort: shortMap[s]||"ja", dstShort: shortMap[d]||"en" });
      const translated = pickText(data) || "";
      $("#translation-result").textContent = translated || "(翻訳できませんでした)";
      if (translated) await speakViaServer(translated, bcpMap[shortMap[d]||d] || "en-US");
    }catch(err){ alert("翻訳に失敗しました"); }
  });

  // テンプレ開始
  templateStartBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    templateStartBtn.style.display = "none";
    showTemplates("caregiver");
  });
});
