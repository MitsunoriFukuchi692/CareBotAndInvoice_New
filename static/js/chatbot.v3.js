// === static/js/chatbot.v3.js — RESCUE/LTS ===
// 1) A→B固定で毎回 src/dst 明示  2) 説明が空でも翻訳実行  3) 必ず音が出る（ブラウザTTS）

console.log("[chatbot.v3.js] RESCUE/LTS: fixed-direction, robust translate, browser TTS");

// ---------- ユーティリティ ----------
const $ = s => document.querySelector(s);
const shortMap = { ja:"ja", en:"en", vi:"vi", tl:"tl", fil:"tl" };
const bcpMap   = { ja:"ja-JP", en:"en-US", vi:"vi-VN", tl:"fil-PH", fil:"fil-PH" };
const toShort  = s => (s||"").split("-")[0].toLowerCase();

// A→B を常に採用（UIの #langA / #langB を使う）
function getFixedPair(){
  const a = $("#langA")?.value || "ja-JP";
  const b = $("#langB")?.value || "en-US";
  const sA = shortMap[toShort(a)] || "ja";
  const sB = shortMap[toShort(b)] || "en";
  return { srcBCP: a, dstBCP: (bcpMap[sB]||b), srcShort: sA, dstShort: sB };
}

// ---------- 音声（ブラウザTTSを強制。確実に鳴る） ----------
function speak(text, langBCP){
  if (!text) return;
  try { speechSynthesis.cancel(); } catch {}
  const u = new SpeechSynthesisUtterance(text);
  u.lang = langBCP || "ja-JP";
  speechSynthesis.speak(u);
}

// ---------- 表示 ----------
function appendMessage(role, text){
  const pane = $("#chat-window"); if (!pane) return;
  const div = document.createElement("div");
  div.className = "message " + (role==="caregiver"?"caregiver":"caree");
  div.textContent = (role==="caregiver"?"介護士: ":"被介護者: ") + text;
  pane.appendChild(div);
  pane.scrollTop = pane.scrollHeight;
}

// ---------- テンプレ（そのまま） ----------
const caregiverTemplates = {
  "体調":["今日は元気ですか？","どこか痛いところはありますか？","疲れは残っていますか？","最近の体温はどうですか？"],
  "食事":["朝ごはんは食べましたか？","食欲はありますか？","最近食べた美味しかったものは？","食事の量は十分でしたか？"],
  "薬":["薬はもう飲みましたか？","飲み忘れはありませんか？","副作用はありますか？","次の薬の時間は覚えていますか？"],
  "睡眠":["昨夜はよく眠れましたか？","途中で目が覚めましたか？","今は眠気がありますか？","夢を見ましたか？"],
  "排便":["便通はありましたか？","お腹は痛くないですか？","便の状態は普通でしたか？","最後に排便したのはいつですか？"]
};
const careeResponses = {
  "体調":["元気です","少し疲れています","腰が痛いです","まあまあです"],
  "食事":["はい、食べました","食欲はあります","今日はあまり食べていません","まだ食べていません"],
  "薬":["はい、飲みました","まだ飲んでいません","飲み忘れました","副作用はありません"],
  "睡眠":["よく眠れました","途中で目が覚めました","眠気があります","眠れませんでした"],
  "排便":["普通でした","少し便秘気味です","下痢でした","昨日ありました"]
};
function showTemplates(role, category=null){
  const box = $("#template-buttons"); if (!box) return;
  box.innerHTML = "";
  if (!category){
    box.className = "template-buttons category";
    Object.keys(caregiverTemplates).forEach(cat=>{
      const b=document.createElement("button"); b.textContent=cat;
      b.onclick=()=>showTemplates("caregiver",cat); box.appendChild(b);
    });
    return;
  }
  const list = role==="caregiver" ? caregiverTemplates[category] : careeResponses[category];
  box.className = "template-buttons "+(role==="caregiver"?"caregiver":"caree");
  list.forEach(t=>{
    const b=document.createElement("button"); b.textContent=t;
    b.onclick=()=>{
      appendMessage(role,t);
      if (role==="caregiver") showTemplates("caree",category); else showTemplates("caregiver");
    };
    box.appendChild(b);
  });
}

// ---------- 用語説明（日本語に読み上げ） ----------
async function fetchExplain(term){
  const r = await fetch("/ja/explain", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ term, maxLength: 30 })
  });
  const j = await r.json().catch(()=>({}));
  return r.ok ? (j.explanation || j.text || "") : "";
}

// ---------- 翻訳 API（毎回 src/dst 明示） ----------
async function apiTranslate(text, srcShort, dstShort){
  const r = await fetch("/ja/translate", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ text, src: srcShort, dst: dstShort })
  });
  return r.json();
}

// ---------- A/B往復（固定方向・確実に読み上げ） ----------
let currentSpeaker = "A";
const other = s=> s==="A"?"B":"A";

async function addTurnAndSpeak(speaker, text){
  const { srcShort, dstShort, dstBCP } = getFixedPair();
  appendMessage(speaker==="A"?"caregiver":"caree", text);

  let translated = "";
  try {
    const j = await apiTranslate(text, srcShort, dstShort);
    translated = (j.dst_text || j.translated || j.text || "").trim();
  } catch (e) {}

  const dstRole = other(speaker)==="A" ? "caregiver" : "caree";
  appendMessage(dstRole, translated || "(翻訳できませんでした)");
  speak(translated || text, dstBCP); // 失敗時でも音は出す（原文を読む）
  currentSpeaker = other(speaker);
}

// ---------- 起動時バインド ----------
document.addEventListener("DOMContentLoaded", ()=>{
  const caregiverInput = $("#caregiver-input");
  const careeInput     = $("#caree-input");
  const caregiverSend  = $("#send-caregiver");
  const careeSend      = $("#send-caree");
  const explainBtn     = $("#explain-btn");
  const translateBtn   = $("#translate-btn");
  const templateStart  = $("#template-start-btn");

  caregiverSend?.addEventListener("click", async ()=>{
    const v = caregiverInput?.value?.trim(); if (!v) return;
    if ($("#convMode")?.checked) await addTurnAndSpeak("A", v); else appendMessage("caregiver", v);
    caregiverInput.value = "";
  });

  careeSend?.addEventListener("click", async ()=>{
    const v = careeInput?.value?.trim(); if (!v) return;
    if ($("#convMode")?.checked) await addTurnAndSpeak("B", v); else appendMessage("caree", v);
    careeInput.value = "";
  });

  // 用語→説明→読み上げ（日本語）
  explainBtn?.addEventListener("click", async ()=>{
    const term = $("#term")?.value?.trim();
    if (!term){ alert("用語を入力してください"); return; }
    explainBtn.disabled = true;
    try{
      const text = await fetchExplain(term);
      $("#explanation").textContent = text || "(取得できませんでした)";
      if (text) speak(text, "ja-JP");
    } finally { explainBtn.disabled = false; }
  });

  // ★「翻訳して読み上げ」：説明が空でも A/B 入力や直近の原文から実行
  translateBtn?.addEventListener("click", async ()=>{
    const { srcShort, dstShort, dstBCP } = getFixedPair();
    const ex  = $("#explanation")?.textContent?.trim();
    const aIn = $("#caregiver-input")?.value?.trim();
    const bIn = $("#caree-input")?.value?.trim();

    // 優先順：説明 → A入力 → B入力 → チャット最終の「原文」
    let srcText = ex || aIn || bIn;
    if (!srcText){
      const msgs = Array.from(document.querySelectorAll("#chat-window .message"));
      for (let i = msgs.length - 1; i >= 0; i--){
        const t = msgs[i].textContent || "";
        const m = t.replace(/^(.+?:\s*)/, "");
        if (m) { srcText = m; break; }
      }
    }
    if (!srcText){ alert("翻訳する文が見つかりません"); return; }

    let out = "";
    try {
      const j = await apiTranslate(srcText, srcShort, dstShort);
      out = (j.dst_text || j.translated || j.text || "").trim();
    } catch (e) {}

    $("#translation-result").textContent = out || "(翻訳できませんでした)";
    speak(out || srcText, dstBCP); // 失敗でも無音にしない
  });

  // テンプレ開始
  templateStart?.addEventListener("click", e=>{
    e.preventDefault(); templateStart.style.display="none"; showTemplates("caregiver");
  });

  console.log("RESCUE/LTS loaded");
});
