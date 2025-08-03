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
  const subOptionsContainer = document.getElementById("subOptionsContainer");

  // 会話の役割（最初は介護士から）
  let currentRole = "caregiver";

  // === メッセージ表示 + 読み上げ（日本語会話用） ===
  function appendMessage(role, text) {
    const div = document.createElement("div");
    div.classList.add("message");
    if (role === "caregiver") div.classList.add("caregiver");
    if (role === "caree") div.classList.add("caree");
    div.textContent = (role === "caregiver" ? "介護士: " : "被介護者: ") + text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    // 日本語会話はブラウザ標準TTSで読み上げ
    if (role === "caregiver" || role === "caree") {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "ja-JP";
      utter.volume = 1.0;
      utter.rate = 1.0;
      window.speechSynthesis.speak(utter);
    }
  }

  // === 会話ログ保存 ===
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const log = chatWindow.innerText.trim();
      if (!log) {
        alert("会話がありません");
        return;
      }
      const now = new Date();
      const timestamp = now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
      const logWithTime = `[${timestamp}]\n${log}`;
      try {
        const res = await fetch("/ja/save_log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ log: logWithTime })
        });
        const data = await res.json();
        if (data.status === "success") {
          alert("会話ログを保存しました。");
        } else {
          alert("保存に失敗しました。");
        }
      } catch (err) {
        alert("エラーが発生しました。");
        console.error(err);
      }
    });
  }

  // === 音声認識（Web Speech API 日本語用） ===
function setupMic(button, input) {
  if (!button) return;

  button.addEventListener("click", () => {
    if (!("webkitSpeechRecognition" in window)) {
      alert("このブラウザは音声認識に対応していません。");
      return;
    }

    const rec = new webkitSpeechRecognition();
    rec.lang = "ja-JP";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = e => {
      input.value = e.results[0][0].transcript;
      console.log("🎤 音声認識結果:", input.value);
    };

    rec.onerror = e => {
      console.error("❌ 音声認識エラー:", e);
      alert("マイク入力でエラーが発生しました。");
    };

    rec.onend = () => {
      console.log("🔚 音声認識終了");
    };

    rec.start();
    console.log("🎤 音声認識開始");
  });
}

setupMic(caregiverMic, caregiverInput);
setupMic(careeMic, careeInput);

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

        // 日本語説明はそのままブラウザ読み上げ
        const utter = new SpeechSynthesisUtterance(data.explanation);
        utter.lang = "ja-JP";
        utter.volume = 1.0;
        utter.rate = 1.0;
        window.speechSynthesis.speak(utter);

      } catch (err) {
        alert("用語説明に失敗しました");
        console.error(err);
      }
    });
  }

  // === 翻訳 + Google TTS 読み上げ ===
  if (translateBtn) {
    translateBtn.addEventListener("click", async () => {
      const text = document.getElementById("explanation").textContent.trim();
      if (!text) {
        alert("先に用語説明を入れてください");
        return;
      }
      try {
        const direction = document.getElementById("translate-direction").value;
        const res = await fetch("/ja/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, direction })
        });
        const data = await res.json();
        document.getElementById("translation-result").textContent = data.translated;

        // 言語コードを決定
        let lang = "en-US";
        if (direction.includes("ja")) lang = "ja-JP";
        if (direction.includes("vi")) lang = "vi-VN";
        if (direction.includes("tl")) lang = "fil-PH";

        // Google TTS を呼び出して音声再生
        const ttsRes = await fetch("/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: data.translated, lang })
        });
        if (ttsRes.ok) {
          const audioBlob = await ttsRes.blob();
          const audioUrl = URL.createObjectURL(audioBlob);

          const audio = document.createElement("audio");
          audio.src = audioUrl;
          audio.autoplay = true;
          document.body.appendChild(audio);
          audio.onended = () => {
            document.body.removeChild(audio);
          };
        } else {
          console.error("TTS API error:", await ttsRes.text());
        }
      } catch (err) {
        alert("翻訳に失敗しました");
        console.error(err);
      }
    });
  }

  // === サブ選択肢（対話候補） ===
  function renderSubOptions(category) {
    if (!subOptionsContainer) return;
    subOptionsContainer.innerHTML = "";

    const optionsMap = {
      "体調": ["元気です", "少し調子が悪い", "休みたい"],
      "薬": ["薬を飲みました", "まだ飲んでいません", "薬が切れました"],
      "排便": ["問題ありません", "便秘気味です", "下痢があります"],
      "睡眠": ["よく眠れました", "眠れなかった", "昼寝しました"],
      "食事": ["全部食べました", "少し残しました", "食欲がありません"]
    };

    const options = optionsMap[category] || [];
    options.forEach(opt => {
      const btn = document.createElement("button");
      btn.textContent = opt;
      btn.classList.add("sub-btn");
      btn.addEventListener("click", () => {
        appendMessage(currentRole, opt);
        currentRole = (currentRole === "caregiver") ? "caree" : "caregiver";
        subOptionsContainer.innerHTML = ""; // 押したら消す
      });
      subOptionsContainer.appendChild(btn);
    });
  }

  // === テンプレート表示（交互に介護士→被介護者） ===
  function showTemplates() {
    templateContainer.innerHTML = "";

    const categories = ["体調", "薬", "排便", "睡眠", "食事"];
    categories.forEach(cat => {
      const btn = document.createElement("button");
      btn.textContent = cat;
      btn.classList.add("template-btn");

      btn.addEventListener("click", () => {
        if (currentRole === "caregiver") {
          appendMessage("caregiver", `${cat}についてどうですか？`);
          currentRole = "caree";
        } else {
          appendMessage("caree", `はい、${cat}は大丈夫です。`);
          currentRole = "caregiver";
        }
        renderSubOptions(cat); // サブ選択肢を表示
      });

      templateContainer.appendChild(btn);
    });
  }

  // === テンプレート開始ボタン ===
  if (templateStartBtn) {
    templateStartBtn.addEventListener("click", () => {
      templateStartBtn.style.display = "none";
      showTemplates();
    });
  }
});
