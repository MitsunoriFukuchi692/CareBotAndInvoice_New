// ===============================
// 音声入力（追記仕様）
// ===============================

const BUILD = "2025-10-17_15:10";
window.JIBUNSHI_BUILD = BUILD;
console.log("[jibunshi.js] BUILD =", BUILD);

// ▼ ここから DOMContentLoaded で囲む
window.addEventListener("DOMContentLoaded", () => {

  const textarea = document.getElementById("questionInput");
  const resultArea = document.getElementById("resultArea");
  let recognition;
  let isRecognizing = false;

  // 音声認識初期化

  if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = false;
    recognition.interimResults = false;

recognition.onstart = () => {
  console.log("🎤 音声認識が開始されました");
};

recognition.onerror = (event) => {
  console.error("❌ 音声認識エラー:", event.error);
};

recognition.onspeechend = () => {
  console.log("🛑 発話が終了しました");
};

    recognition.onresult = function (event) {
      const transcript = event.results[0][0].transcript;
      if (textarea.value) {
        textarea.value += "\n" + transcript;
      } else {
        textarea.value = transcript;
      }
    };

    recognition.onend = function () {
      isRecognizing = false;
      document.getElementById("voiceBtn").textContent = "🎤 音声入力";
    };
  }

  // 音声入力ボタン
  document.getElementById("voiceBtn").addEventListener("click", () => {
    if (isRecognizing) {
      recognition.stop();
      isRecognizing = false;
      document.getElementById("voiceBtn").textContent = "🎤 音声入力";
    } else {
      recognition.start();
      isRecognizing = true;
      document.getElementById("voiceBtn").textContent = "■ 停止";
    }
  });

  // プリセットボタン
  document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      textarea.value = btn.textContent;
    });
  });

  // 質問欄に追加
  document.getElementById("addQuestionBtn").addEventListener("click", () => {
    const text = textarea.value.trim();
    if (text === "") return;
    const newBtn = document.createElement("button");
    newBtn.textContent = text;
    newBtn.className = "preset-btn";
    newBtn.addEventListener("click", () => {
      textarea.value = newBtn.textContent;
    });
    document.getElementById("presetArea").appendChild(newBtn);
    textarea.value = "";
  });

  // 生成ボタン
  document.getElementById("generateBtn").addEventListener("click", async () => {
    const prompt = textarea.value.trim();
    if (prompt === "") return;
    resultArea.value += (resultArea.value ? "\n\n" : "") + "【質問】\n" + prompt + "\n【返答】\n" + "ここに生成結果が表示されます。";
  });

  // クリア
  document.getElementById("clearBtn").addEventListener("click", () => {
    textarea.value = "";
  });

  // 結果コピー
  document.getElementById("copyResultBtn").addEventListener("click", () => {
    resultArea.select();
    document.execCommand("copy");
    alert("結果をコピーしました！");
  });

  // TXTダウンロード
  document.getElementById("downloadTxtBtn").addEventListener("click", () => {
    const blob = new Blob([resultArea.value], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "jibunshi.txt";
    link.click();
  });

}); // ▲ ここで閉じる
