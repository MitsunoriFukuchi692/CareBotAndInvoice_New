// === static/js/chatbot.v3.js — RESCUE3 ===
// 1) A→B固定で毎回 src/dst 明示  2) 翻訳失敗でも無音にしない
// 3) /tts → 失敗時はブラウザTTS  4) 重要: MutationObserverで新規メッセージを自動読み上げ

console.log("[chatbot.v3.js] RESCUE3: observe messages & speak, fixed A->B");

const $ = s => document.querySelector(s);
const shortMap = { ja:"ja", en:"en", vi:"vi", tl:"tl", fil:"tl" };
const bcpMap   = { ja:"ja-JP", en:"en-US", vi:"vi-VN", tl:"fil-PH", fil:"fil-PH" };
const toShort  = s => (s||"").split("-")[0].toLowerCase();

function getFixedPair(){
  const a = $("#langA")?.value || "ja-JP";
  const b = $("#langB")?.value || "en-US";
  const sA = shortMap[toShort(a)] || "ja";
  const sB = shortMap[toShort(b)] || "en";
  return { srcBCP:a, dstBCP:(bcpMap[sB]||b), srcShort:sA, dstShort:sB, aBCP:(bcpMap[sA]||a), bBCP:(bcpMap[sB]||b) };
}

// ---- モバイル音声解錠 ----
let __audioUnlocked = false;
window.addEventListener("pointerdown", ()=>{
  if (__audioUnlocked) return;
  try{ const a=new Audio(); a.muted=true; a.play().finally(()=>{ __audioUnlocked=true; }); }catch{}
},{once:true});

// ---- 読み上げ：サーバTTS→失敗時ブラウザTTS ----
async function speakSmart(text, langBCP){
  if (!text) return;
  try{
    const r = await fetch("/tts", { method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ text, lang: langBCP }) });
    if (r.ok){
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = new Audio(url); a.playsInline = true; await a.play().catch(()=>{});
      setTimeout(()=>URL.revokeObjectURL(url), 8000); return;
    }
  }catch{}
  try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang=langBCP||"ja-JP"; speechSynthesis.speak(u); }catch{}
}

// ---- 表示 ----
function appendMessage(role, text){
  const pane = $("#chat-window"); if (!pane) return;
  const div = document.createElement("div");
  div.className = "message " + (role==="caregiver"?"caregiver":"caree");
  div.textContent = (role==="caregiver"?"介護士: ":"被介護者: ") + text;
  pane.appendChild(div);
  pane.scrollTop = pane.scrollHeight;
  // 自前追加にはspokenフラグを付けて二重読み上げ防止
  div.dataset.spoken = "0";
}

// ---- 用語説明 ----
async function fetchExplain(term){
  const r = await fetch("/ja/explain", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ term, maxLength: 30 })
  });
  const j = await r.json().catch(()=>({}));
  return r.ok ? (j.explanation || j.text || "") : "";
}

// ---- 翻訳 API ----
async function apiTranslate(text, srcShort, dstShort){
  const r = await fetch("/ja/translate", {
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ text, src: srcShort, dst: dstShort })
  });
  return r.json();
}

// ---- 会話（A→B固定・訳後に読み上げ）----
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
  await speakSmart(translated || text, dstBCP);   // 無音にしない
  currentSpeaker = other(speaker);
}

// ---- 新規メッセージを監視して自動読み上げ（重要） ----
function installMessageObserver(){
  const pane = $("#chat-window"); if (!pane) return;
  const obs = new MutationObserver((mutList)=>{
    const { aBCP, bBCP } = getFixedPair();
    for (const m of mutList){
      m.addedNodes.forEach(async node=>{
        if (!(node instanceof HTMLElement)) return;
        if (!node.classList.contains("message")) return;
        // 二重防止
        if (node.dataset.spoken === "1") return;
        // 役割で言語を決定（caregiver→A言語、caree→A言語が多いが、ここではA/B設定に追従）
        const isCaregiver = node.classList.contains("caregiver");
        const lang = isCaregiver ? aBCP : aBCP; // 介護支援ボットでは両者とも日本語が自然
        const text = (node.textContent || "").replace(/^.+?:\s*/, "").trim();
        if (!text) return;
        node.dataset.spoken = "1";
        await speakSmart(text, lang);
      });
    }
  });
  obs.observe(pane, { childList:true, subtree:false });
}

// ---- 起動時バインド ----
document.addEventListener("DOMContentLoaded", ()=>{
  const caregiverInput = $("#caregiver-input");
  const careeInput     = $("#caree-input");
  const caregiverSend  = $("#send-caregiver");
  const careeSend      = $("#send-caree");
  const explainBtn     = $("#explain-btn");
  const translateBtn   = $("#translate-btn");

  caregiverSend?.addEventListener("click", async ()=>{
    const v = caregiverInput?.value?.trim(); if (!v) return;
    if ($("#convMode")?.checked) await addTurnAndSpeak("A", v);
    else { appendMessage("caregiver", v); await speakSmart(v, getFixedPair().aBCP); }
    caregiverInput.value = "";
  });

  careeSend?.addEventListener("click", async ()=>{
    const v = careeInput?.value?.trim(); if (!v) return;
    if ($("#convMode")?.checked) await addTurnAndSpeak("B", v);
    else { appendMessage("caree", v); await speakSmart(v, getFixedPair().aBCP); }
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
      const msgs = Array.from(document.querySelectorAll("#chat-window .message"));
      for (let i=msgs.length-1;i>=0;i--){
        const t = msgs[i].textContent||""; const m=t.replace(/^.+?:\s*/,"");
        if (m){ srcText=m; break; }
      }
    }
    if (!srcText){ alert("翻訳する文が見つかりません"); return; }
    let out = "";
    try{ const j = await apiTranslate(srcText, srcShort, dstShort);
         out = (j.dst_text || j.translated || j.text || "").trim();
    }catch{}
    $("#translation-result").textContent = out || "(翻訳できませんでした)";
    await speakSmart(out || srcText, dstBCP);
  });

  installMessageObserver(); // ★ 他ロジックで追加された発話も自動読み上げ
  console.log("RESCUE3 loaded");
});
