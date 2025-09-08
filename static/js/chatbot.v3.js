// === static/js/chatbot.v3.js (A→B固定 + 失敗検出リトライ版) ===
console.log("[chatbot.v3.js] fixed A->B + strict translate + TTS dst");

let __audioUnlocked = false;
window.addEventListener("touchstart", () => {
  if (__audioUnlocked) return;
  const a = new Audio(); a.muted = true; a.playsInline = true;
  a.play().catch(()=>{}).finally(()=>{ __audioUnlocked = true; });
}, { once:true });

const $ = s => document.querySelector(s);
const shortMap = { ja:"ja", en:"en", vi:"vi", tl:"tl", fil:"tl" };
const bcpMap   = { ja:"ja-JP", en:"en-US", vi:"vi-VN", tl:"fil-PH", fil:"fil-PH" };
const toShort  = s => (s||"").split("-")[0].toLowerCase();

function getFixedPair(){
  const a = $("#langA")?.value || "ja-JP";
  const b = $("#langB")?.value || "en-US";
  const sA = shortMap[toShort(a)] || "ja";
  const sB = shortMap[toShort(b)] || "en";
  return { srcBCP:a, dstBCP:(bcpMap[sB]||b), srcShort:sA, dstShort:sB };
}

// ---------- TTS ----------
async function speakViaServer(text, langBCP){
  if (!text) return;
  try{
    const r = await fetch("/tts", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ text, lang: langBCP })
    });
    if (!r.ok) throw new Error("TTS HTTP "+r.status);
    const blob = await r.blob(); const url = URL.createObjectURL(blob);
    try{ const a=new Audio(url); a.playsInline=true; await a.play(); }
    finally{ URL.revokeObjectURL(url); }
  }catch{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langBCP || "ja-JP";
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
}

// ---------- UI表示 ----------
function appendMessage(role, text){
  const pane = $("#chat-window"); if (!pane) return;
  const div = document.createElement("div");
  div.className = "message " + (role==="caregiver"?"caregiver":"caree");
  div.textContent = (role==="caregiver"?"介護士: ":"被介護者: ") + text;
  pane.appendChild(div); pane.scrollTop = pane.scrollHeight;
}

// ---------- テンプレ ----------
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

// ---------- 音声入力 ----------
function setupMic(btn, input){
  if (!btn || !input) return;
  btn.addEventListener("click", ()=>{
    try{
      const R = new (window.SpeechRecognition||window.webkitSpeechRecognition)();
      R.lang="ja-JP"; R.onresult = e=> input.value = e.results[0][0].transcript; R.start();
    }catch{ alert("音声入力が使えません"); }
  });
}

// ---------- 翻訳（厳格抽出 + 失敗時リトライ） ----------
function extractTranslated(obj){
  if (!obj) return "";
  // サーバの様々な返却形に対応
  return (
    obj.dst_text ||
    obj.translated ||
    obj.translatedText ||
    obj.data?.translations?.[0]?.translatedText ||
    obj.choices?.[0]?.message?.content ||
    obj.text || ""
  );
}
function sameAfterNormalize(a,b){
  const n = s => (s||"").replace(/\s+/g,"").replace(/[、。,.!?！？]/g,"");
  return n(a) === n(b);
}
async function apiTranslateStrict(text, srcShort, dstShort, maxRetry=1){
  for (let i=0;i<=maxRetry;i++){
    const r = await fetch("/ja/translate", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ text, src: srcShort, dst: dstShort, force:true, retry:i })
    });
    const j = await r.json().catch(()=>({}));
    const out = extractTranslated(j);
    if (out && !sameAfterNormalize(out, text)) return out;
    // 小さな待機 → 再試行
    await new Promise(res => setTimeout(res, 180));
  }
  return ""; // 最終的に失敗
}

// ---------- A/B往復（方向固定） ----------
let currentSpeaker = "A";
const other = s=> s==="A"?"B":"A";

async function addTurnAndSpeak(speaker, text){
  const { srcShort, dstShort, dstBCP } = getFixedPair(); // 常にA→B
  appendMessage(speaker==="A"?"caregiver":"caree", text);

  const translated = await apiTranslateStrict(text, srcShort, dstShort, 2);
  const dstRole = other(speaker)==="A" ? "caregiver" : "caree";
  appendMessage(dstRole, translated || "(翻訳できませんでした)");

  if (translated) await speakViaServer(translated, dstBCP);
  currentSpeaker = other(speaker);
}

// ---------- 起動 ----------
document.addEventListener("DOMContentLoaded", ()=>{
  const caregiverInput = $("#caregiver-input");
  const careeInput     = $("#caree-input");
  const caregiverSend  = $("#send-caregiver");
  const careeSend      = $("#send-caree");
  const explainBtn     = $("#explain-btn");
  const translateBtn   = $("#translate-btn");
  const templateStart  = $("#template-start-btn");
  const caregiverMic   = $("#mic-caregiver");
  const careeMic       = $("#mic-caree");

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

  setupMic(caregiverMic, caregiverInput);
  setupMic(careeMic, careeInput);

  // 用語→説明→読み上げ
  explainBtn?.addEventListener("click", async ()=>{
    const term = $("#term")?.value?.trim(); const out = $("#explanation");
    if (!term){ alert("用語を入力してください"); return; }
    explainBtn.disabled = true; out.textContent = "";
    try {
      const r = await fetch("/ja/explain", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ term, maxLength:30 })
      });
      const j = await r.json().catch(()=>({}));
      const text = j.explanation || j.text || "";
      out.textContent = text || "(取得できませんでした)";
      if (text) await speakViaServer(text, "ja-JP");
    } finally { explainBtn.disabled = false; }
  });

  // 単発翻訳（固定方向）
  translateBtn?.addEventListener("click", async ()=>{
    const s = $("#explanation")?.textContent?.trim();
    if (!s){ alert("先に用語説明を入れてください"); return; }
    const fp = getFixedPair();
    try{
      const out = await apiTranslateStrict(s, fp.srcShort, fp.dstShort, 2);
      $("#translation-result").textContent = out || "(翻訳できませんでした)";
      if (out) await speakViaServer(out, fp.dstBCP);
    }catch{ alert("翻訳に失敗しました"); }
  });

  // テンプレ開始
  templateStart?.addEventListener("click", e=>{
    e.preventDefault(); templateStart.style.display="none"; showTemplates("caregiver");
  });
});
