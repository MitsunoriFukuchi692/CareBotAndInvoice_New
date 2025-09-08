// === static/js/chatbot.v3.js — RESCUE4 ===
// ・ページ自動判定: /translate は A(原文)→B(訳)の言語で読み上げ
// ・テンプレクリックでも必ず読み上げ
// ・MutationObserver を document 全体に張って、外部追加メッセージも読み上げ
console.log("[chatbot.v3.js] RESCUE4: per-page speak logic + template speak + wide observe");

const $ = s => document.querySelector(s);
const shortMap = { ja:"ja", en:"en", vi:"vi", tl:"tl", fil:"tl" };
const bcpMap   = { ja:"ja-JP", en:"en-US", vi:"vi-VN", tl:"fil-PH", fil:"fil-PH" };
const toShort  = s => (s||"").split("-")[0].toLowerCase();
const isGuidePage = location.pathname.includes("/translate"); // 翻訳学習／観光案内なら true

function getFixedPair(){
  const a = $("#langA")?.value || "ja-JP";
  const b = $("#langB")?.value || "en-US";
  const sA = shortMap[toShort(a)] || "ja";
  const sB = shortMap[toShort(b)] || "en";
  return {
    srcBCP:a, dstBCP:(bcpMap[sB]||b), srcShort:sA, dstShort:sB,
    aBCP:(bcpMap[sA]||a), bBCP:(bcpMap[sB]||b)
  };
}

// ---- 音声: /tts → 失敗時はブラウザTTS ----
async function speakSmart(text, langBCP){
  if (!text) return;
  try{
    const r = await fetch("/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,lang:langBCP})});
    if (r.ok){
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = new Audio(url); a.playsInline = true; await a.play().catch(()=>{});
      setTimeout(()=>URL.revokeObjectURL(url), 8000); return;
    }
  }catch{}
  try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang=langBCP||"ja-JP"; speechSynthesis.speak(u);}catch{}
}

// ---- 表示補助 ----
function appendMessage(role, text){
  const pane = $("#chat-window") || document.body;
  const div = document.createElement("div");
  div.className = "message " + (role==="caregiver"?"caregiver":"caree");
  div.textContent = (role==="caregiver"?"介護士: ":"被介護者: ") + text;
  pane.appendChild(div);
  if (pane.scrollTop!=null) pane.scrollTop = pane.scrollHeight || pane.scrollTop;
  div.dataset.spoken = "0";
}

// ---- 用語説明＆翻訳 ----
async function fetchExplain(term){
  const r = await fetch("/ja/explain",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({term,maxLength:30})});
  const j = await r.json().catch(()=>({})); return r.ok ? (j.explanation||j.text||"") : "";
}
async function apiTranslate(text, srcShort, dstShort){
  const r = await fetch("/ja/translate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,src:srcShort,dst:dstShort})});
  return r.json();
}

// ---- A/B往復 ----
let currentSpeaker = "A";
const other = s=> s==="A"?"B":"A";
async function addTurnAndSpeak(speaker, text){
  const { srcShort, dstShort, dstBCP } = getFixedPair();
  appendMessage(speaker==="A"?"caregiver":"caree", text);

  let translated = "";
  try{ const j = await apiTranslate(text, srcShort, dstShort);
       translated = (j.dst_text || j.translated || j.text || "").trim();
  }catch{}
  const dstRole = other(speaker)==="A" ? "caregiver" : "caree";
  appendMessage(dstRole, translated || "(翻訳できませんでした)");
  await speakSmart(translated || text, dstBCP);
  currentSpeaker = other(speaker);
}

// ---- テンプレ（クリックで必ず読み上げ）----
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
    b.onclick=async ()=>{
      appendMessage(role,t);
      const { aBCP, bBCP } = getFixedPair();
      // 介護支援: どちらも日本語 / 翻訳学習: caregiver→A言語, caree→B言語
      const lang = isGuidePage ? (role==="caregiver" ? aBCP : bBCP) : aBCP;
      await speakSmart(t, lang);
      if (role==="caregiver") showTemplates("caree",category); else showTemplates("caregiver");
    };
    box.appendChild(b);
  });
}

// ---- 新規メッセージ自動読み上げ（広域監視）----
function installMessageObserver(){
  const target = document.body;                 // ページ全体を監視
  const obs = new MutationObserver((mutList)=>{
    const { aBCP, bBCP } = getFixedPair();
    for (const m of mutList){
      m.addedNodes.forEach(async node=>{
        if (!(node instanceof HTMLElement)) return;
        if (!node.classList.contains("message")) return;
        if (node.dataset.spoken === "1") return;
        const isCaregiver = node.classList.contains("caregiver");
        // ページ別言語
        const lang = isGuidePage ? (isCaregiver ? aBCP : bBCP) : aBCP;
        const text = (node.textContent || "").replace(/^.+?:\s*/, "").trim();
        if (!text) return;
        node.dataset.spoken = "1";
        await speakSmart(text, lang);
      });
    }
  });
  obs.observe(target, { childList:true, subtree:true });
}

// ---- 起動バインド ----
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
    if ($("#convMode")?.checked) await addTurnAndSpeak("A", v);
    else { appendMessage("caregiver", v); const {aBCP}=getFixedPair(); await speakSmart(v, isGuidePage?aBCP:aBCP); }
    caregiverInput.value = "";
  });

  careeSend?.addEventListener("click", async ()=>{
    const v = careeInput?.value?.trim(); if (!v) return;
    if ($("#convMode")?.checked) await addTurnAndSpeak("B", v);
    else { appendMessage("caree", v); const {aBCP,bBCP}=getFixedPair(); await speakSmart(v, isGuidePage?bBCP:aBCP); }
    careeInput.value = "";
  });

  explainBtn?.addEventListener("click", async ()=>{
    const term = $("#term")?.value?.trim();
    if (!term){ alert("用語を入力してください"); return; }
    explainBtn.disabled = true;
    try{
      const text = await fetchExplain(term);
      $("#explanation").textContent = text || "(取得できませんでした)";
      if (text) await speakSmart(text, "ja-JP");
    }finally{ explainBtn.disabled = false; }
  });

  translateBtn?.addEventListener("click", async ()=>{
    const { srcShort, dstShort, dstBCP } = getFixedPair();
    const ex  = $("#explanation")?.textContent?.trim();
    const aIn = $("#caregiver-input")?.value?.trim();
    const bIn = $("#caree-input")?.value?.trim();
    let srcText = ex || aIn || bIn;
    if (!srcText){
      const msgs = Array.from(document.querySelectorAll("#chat-window .message,.message"));
      for (let i=msgs.length-1;i>=0;i--){
        const t = msgs[i].textContent||""; const m=t.replace(/^.+?:\s*/,"").trim();
        if (m){ srcText=m; break; }
      }
    }
    if (!srcText){ alert("翻訳する文が見つかりません"); return; }
    let out = "";
    try{ const j = await apiTranslate(srcText, srcShort, dstShort); out = (j.dst_text || j.translated || j.text || "").trim(); }catch{}
    $("#translation-result").textContent = out || "(翻訳できませんでした)";
    await speakSmart(out || srcText, dstBCP);
  });

  templateStart?.addEventListener("click", e=>{ e.preventDefault(); templateStart.style.display="none"; showTemplates("caregiver"); });
  installMessageObserver();
  console.log("RESCUE4 loaded");
});
