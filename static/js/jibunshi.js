// ===============================
// 音声入力（追記仕様）
// ===============================
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

  recognition.onresult = function (event) {
    const transcript = event.results[0][0].transcript;
    // 追記仕様（上書きではなく追加）
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

// ===============================
// 質問プリセットボタン
// ===============================
document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    textarea.value = btn.textContent;
  });
});

// ===============================
// 質問欄に追加
// ===============================
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

// ===============================
// 生成ボタン（OpenAIなどのAPIと接続する場合ここ）
// ===============================
document.getElementById("generateBtn").addEventListener("click", async () => {
  const prompt = textarea.value.trim();
  if (prompt === "") return;

  // ここは本来API接続処理（例：fetchでOpenAIへ送信）
  // デモとしてそのまま出力
  resultArea.value += (resultArea.value ? "\n\n" : "") + "【質問】\n" + prompt + "\n【返答】\n" + "ここに生成結果が表示されます。";
});

// ===============================
// クリア
// ===============================
document.getElementById("clearBtn").addEventListener("click", () => {
  textarea.value = "";
});

// ===============================
// 結果をコピー
// ===============================
document.getElementById("copyResultBtn").addEventListener("click", () => {
  resultArea.select();
  document.execCommand("copy");
  alert("結果をコピーしました！");
});

// ===============================
// .txtとしてダウンロード
// ===============================
document.getElementById("downloadTxtBtn").addEventListener("click", () => {
  const blob = new Blob([resultArea.value], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "jibunshi.txt";
  link.click();
});
