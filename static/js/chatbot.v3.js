console.log("✅ chatbot.v3.js 読み込みOK");

document.addEventListener("DOMContentLoaded", () => {
  console.log("👉 スクリプト開始");

  // 要素取得
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

  // === テンプレート定義 ===
  const caregiverTemplates = {
    "体調": ["今日は元気ですか？", "どこか痛いところはありますか？", "疲れは残っていますか？", "最近の体温はどうですか？"],
    "食事": ["朝ごはんは食べましたか？", "食欲はありますか？", "最近食べた美味しかったものは？", "食事の量は十分でしたか？"],
    "薬": ["薬はもう飲みましたか？", "飲み忘れはありませんか？", "薬を飲んで副作用はありますか？", "次の薬の時間は覚えていますか？"],
    "睡眠": ["昨夜はよく眠れましたか？", "途中で目が覚めましたか？", "今は眠気がありますか？", "夢を見ましたか？"],
    "排便": ["便通はありましたか？", "お腹は痛くないですか？", "便の状態は普通でしたか？", "最後に排便したのはいつですか？"]
  };

  const careeResponses = {
    "体調": ["元気です", "少し疲れています", "腰が痛いです", "まあまあです"],
    "食事": ["はい、食べました", "食欲はあります", "今日はあまり食べていません", "まだ食べていません"],
    "薬": ["はい、飲みました", "まだ飲んでいません", "飲み忘れました", "副作用はありません"],
    "睡眠": ["よく眠れました", "途中で目が覚めました", "眠気があります", "眠れませんでした"],
    "排便": ["普通でした", "少し便秘気味です", "下痢でした", "昨日ありました"]
  };

  // === メッセージ表示 + 読み上げ ===
  function appendMessage(role, text) {
    const div = document.createElement("div");
    div.classList.add("message");
    if (role === "caregiver") div.classList.add("caregiver");
    if (role === "caree") div.classList.add("caree");
    div.textContent = (role === "caregiver" ? "介護士: " : "被介護者: ") + text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    // 🔊 読み上げ
    speak(text, role);
  }

  // === 音声読み上げ ===
  function speak(text, role) {
    if (!text) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.volume = 1.0;
    utter.rate = 1.0;

    if (role === "caregiver" || role === "caree") {
      utter.lang = "ja-JP"; // 日本語会話
    }
    if (role === "caregiver") {
      utter.voice = speechSynthesis.getVoices().find(v => v.lang === "ja-JP" && v.name.includes("Male")) || null;
    } else if (role === "caree") {
      utter.voice = speechSynthesis.getVoices().find(v => v.lang === "ja-JP" && v.name.includes("Female")) || null;
    }
    window.speechSynthesis.speak(utter);
  }

  // === テンプレート表示 ===
  function showTemplates(role, category = null) {
    templateContainer.innerHTML = "";

    // ステップ1: カテゴリ選択
    if (!category) {
      const categories = Object.keys(caregiverTemplates);
      templateContainer.className = "template-buttons category";
      categories.forEach(cat => {
        const btn = document.createElement("button");
        btn.textContent = cat;
        btn.addEventListener("click", () => showTemplates("caregiver", cat));
        templateContainer.appendChild(btn);
      });
      return;
    }

    // ステップ2: 質問／返答
    let templates = [];
    if (role === "caregiver") {
      templates = caregiverTemplates[category];
      templateContainer.className = "template-buttons caregiver";
    } else if (role === "caree") {
      templates = careeResponses[category];
      templateContainer.className = "template-buttons caree";
    }

    templates.forEach(text => {
      const btn = document.createElement("button");
      btn.textContent = text;
      btn.addEventListener("click", () => {
        appendMessage(role, text);
        if (role === "caregiver") {
          showTemplates("caree", category);  // 次は被介護者
        } else {
          showTemplates("caregiver");        // 回答後はカテゴリ選択に戻る
        }
      });
      templateContainer.appendChild(btn);
    });
  }

  // === ボタンイベント ===
  if (templateStartBtn) {
    templateStartBtn.addEventListener("click", () => {
      templateStartBtn.style.display = "none";
      showTemplates("caregiver");
    });
  }

  if (caregiverSend) caregiverSend.addEventListener("click", () => {
    appendMessage("caregiver", caregiverInput.value);
    caregiverInput.value = "";
  });
  if (careeSend) careeSend.addEventListener("click", () => {
    appendMessage("caree", careeInput.value);
    careeInput.value = "";
  });

  // 音声認識（介護士）
  if (caregiverMic) {
    caregiverMic.addEventListener("click", () => {
      const rec = new webkitSpeechRecognition();
      rec.lang = "ja-JP";
      rec.onresult = e => caregiverInput.value = e.results[0][0].transcript;
      rec.start();
    });
  }

  // 音声認識（被介護者）
  if (careeMic) {
    careeMic.addEventListener("click", () => {
      const rec = new webkitSpeechRecognition();
      rec.lang = "ja-JP";
      rec.onresult = e => careeInput.value = e.results[0][0].transcript;
      rec.start();
    });
  }

  // === 用語説明 ===
  if (explainBtn) {
    explainBtn.addEventListener("click", async () => {
      const term = document.getElementById("term").value.trim();
      if (!term) {
        alert("用語を入力してください");
        return;
      }
      try {
        const res = await fetch("/ja/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term, maxLength: 30 })
        });
        const data = await res.json();
        document.getElementById("explanation").textContent = data.explanation;
        speak(data.explanation, "caregiver"); // 🔊 日本語で読み上げ
      } catch (err) {
        alert("用語説明に失敗しました");
        console.error(err);
      }
    });
  }

  // === 翻訳 ===
  if (translateBtn) {
    translateBtn.addEventListener("click", async () => {
      const text = document.getElementById("explanation").textContent.trim();
      if (!text) {
        alert("先に用語説明を入れてください");
        return;
      }
      try {
        const res = await fetch("/ja/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, direction: "ja-en" })
        });
        const data = await res.json();
        document.getElementById("translation-result").textContent = data.translated;

        // 🔊 英語をアメリカ英語で読み上げ
        const utter = new SpeechSynthesisUtterance(data.translated);
        utter.lang = "en-US";  // アメリカ英語発音
        utter.rate = 1.0;
        utter.volume = 1.0;
        window.speechSynthesis.speak(utter);
      } catch (err) {
        alert("翻訳に失敗しました");
        console.error(err);
      }
    });
  }
});
