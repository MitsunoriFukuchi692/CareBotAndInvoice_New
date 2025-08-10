console.log("✅ chatbot.v3.js 読み込みOK");

document.addEventListener("DOMContentLoaded", () => {
  console.log("👉 スクリプト開始");

  // 要素
  const chatWindow = document.getElementById("chat-window");
  const caregiverInput = document.getElementById("caregiver-input");
  const careeInput = document.getElementById("caree-input");
  const caregiverSend = document.getElementById("send-caregiver");
  const careeSend = document.getElementById("send-caree");
  const explainBtn = document.getElementById("explain-btn");
  const translateBtn = document.getElementById("translate-btn");
  const saveBtn = document.getElementById("save-log-btn");
  const templateStartBtn = document.getElementById("template-start-btn");
  const templateContainer = document.getElementById("template-buttons");
  const caregiverMic = document.getElementById("mic-caregiver");
  const careeMic = document.getElementById("mic-caree");

  // テンプレ
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

  // 表示＋読み上げ
  function appendMessage(role, text){
    const div = document.createElement("div");
    div.classList.add("message");
    if (role === "caregiver") div.classList.add("caregiver");
    if (role === "caree")     div.classList.add("caree");
    div.textContent = (role==="caregiver"?"介護士: ":"被介護者: ")+ text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    speak(text, role);
  }
  function speak(text, role){
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.volume = 1.0; u.rate = 1.0;
    if (role==="caregiver" || role==="caree") u.lang = "ja-JP";
    if (role==="translation")                 u.lang = "en-US";
    window.speechSynthesis.speak(u);
  }

  // テンプレUI
  function showTemplates(role, category=null){
    templateContainer.innerHTML = "";
    if (!category){
      const cats = Object.keys(caregiverTemplates);
      templateContainer.className = "template-buttons category";
      cats.forEach(cat=>{
        const b=document.createElement("button");
        b.textContent=cat;
        b.addEventListener("click",()=>showTemplates("caregiver",cat));
        templateContainer.appendChild(b);
      });
      return;
    }
    let templates=[];
    if (role==="caregiver"){ templates = caregiverTemplates[category]; templateContainer.className="template-buttons caregiver"; }
    else { templates = careeResponses[category]; templateContainer.className="template-buttons caree"; }
    templates.forEach(t=>{
      const b=document.createElement("button");
      b.textContent=t;
      b.addEventListener("click",()=>{
        appendMessage(role,t);
        if (role==="caregiver") showTemplates("caree",category);
        else                    showTemplates("caregiver");
      });
      templateContainer.appendChild(b);
    });
  }

  // 会話ログ保存
  if (saveBtn){
    saveBtn.addEventListener("click", async ()=>{
      const log = chatWindow.innerText.trim();
      if (!log){ alert("会話がありません"); return; }
      const ts = new Date().toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
      const logWithTime = `[${ts}]\n${log}`;
      try{
        const res = await fetch("/ja/save_log",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({log:logWithTime})});
        const data = await res.json();
        if (data.status==="success") alert("会話ログを保存しました。"); else alert("保存に失敗しました。");
      }catch(e){ console.error(e); alert("エラーが発生しました。"); }
    });
  }

  // 音声認識
  function setupMic(btn, input){
    if (!btn) return;
    btn.addEventListener("click", ()=>{
      const rec = new webkitSpeechRecognition();
      rec.lang="ja-JP";
      rec.onresult = e => input.value = e.results[0][0].transcript;
      rec.start();
    });
  }
  setupMic(caregiverMic, caregiverInput);
  setupMic(careeMic, careeInput);

  // 送信
  if (caregiverSend) caregiverSend.addEventListener("click", ()=>{ if (caregiverInput.value.trim()){ appendMessage("caregiver",caregiverInput.value); caregiverInput.value=""; }});
  if (careeSend)     careeSend.addEventListener("click",     ()=>{ if (careeInput.value.trim()){     appendMessage("caree",careeInput.value);     careeInput.value=""; }});

  // === 用語説明（definition対応・堅牢） ===
  if (explainBtn){
    explainBtn.addEventListener("click", async ()=>{
      const term = document.getElementById("term").value.trim();
      if (!term){ alert("用語を入力してください"); return; }
      try{
        const res = await fetch("/ja/explain",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({term, maxLength:30})
        });
        console.log("[explain] status:", res.status);
        const data = await res.json();
        console.log("[explain] json:", data);

        let text = "";
        if (typeof data === "string") {
          text = data;
        } else if (data) {
          text =
            data.explanation ||
            data.definition ||   // ← 追加
            data.message ||
            data.result ||
            data.summary ||
            data.text ||
            (Array.isArray(data.choices) && data.choices[0]?.message?.content) ||
            "";
        }

        document.getElementById("explanation").textContent =
          (text && String(text).trim()) || "(取得できませんでした)";

        if (text) speak(text,"caregiver");
      }catch(err){
        console.error("[explain] error:", err);
        alert("用語説明に失敗しました");
      }
    });
  }

  // 翻訳
  if (translateBtn){
    translateBtn.addEventListener("click", async ()=>{
      const text = document.getElementById("explanation").textContent.trim();
      if (!text){ alert("先に用語説明を入れてください"); return; }
      try{
        const direction = document.getElementById("translate-direction").value;
        const res = await fetch("/ja/translate",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({text, direction})
        });
        const data = await res.json();
        document.getElementById("translation-result").textContent = data.translated;

        const speakLangMap = {ja:"ja-JP", en:"en-US", vi:"vi-VN", tl:"fil-PH"};
        const targetLang = direction.split("-")[1];
        const u = new SpeechSynthesisUtterance(data.translated);
        u.lang = speakLangMap[targetLang] || "en-US";
        u.volume=1.0; u.rate=1.0;
        window.speechSynthesis.speak(u);
      }catch(err){
        console.error("[translate] error:", err);
        alert("翻訳に失敗しました");
      }
    });
  }

  // テンプレ開始
  if (templateStartBtn){
    templateStartBtn.addEventListener("click", ()=>{
      templateStartBtn.style.display="none";
      showTemplates("caregiver");
    });
  }
});
