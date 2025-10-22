// build 2025-10-16-stable

(() => {
  // ===============================
  // 📝 プリセット（章番号付き）
  // ===============================
  const PRESETS = {
    "第1章 生い立ち": [
      "幼少期の家庭環境（家族構成／暮らしの雰囲気）を温度感が伝わる描写で。",
      "いちばん好きだった遊びと、その時の匂い・音・季節感を書いてください。",
      "祖父母・近所の大人から受けた言葉で、今も覚えているものは？"
    ],
    "第2章 学生時代": [
      "学校生活での楽しかったこと、挫折と乗り越えを書いてください。",
      "恩師や友人との印象に残る会話・影響を受けた経験を書いてください。"
    ],
    "第3章 仕事": [
      "初めての就職／起業の動機、その時の不安・覚悟を書いてください。",
      "仕事で得た成果と、その裏にあった工夫・仲間・偶然について。"
    ],
    "第4章 家族": [
      "家族・子ども・親とのエピソードで、性格や関係性が伝わる場面を。",
      "家族旅行などの行事で印象深いシーンと、その背景を書いてください。"
    ],
    "第5章 転機": [
      "進学・就職・転職・病気・引越など、大きな転機の理由を具体的に。",
      "そのときに支えになった人・言葉・小さな行動について。"
    ],
    "第6章 これから": [
      "これからやってみたいこと（家族・仕事・地域）を宣言として。",
      "次の世代に伝えたい、あなたの『やってよかった3つ』。"
    ]
  };

  const $ = (q) => document.querySelector(q);
  const state = { activeTab: Object.keys(PRESETS)[0] };

  // ===============================
  // 🟡 プリセットタブ
  // ===============================
  function renderTabs() {
    const wrap = $("#presetTabs");
    wrap.innerHTML = "";
    Object.keys(PRESETS).forEach(name => {
      const btn = document.createElement("button");
      btn.textContent = name;
      btn.className = state.activeTab === name ? "active" : "";
      btn.onclick = () => { state.activeTab = name; renderPresets(); renderTabs(); };
      wrap.appendChild(btn);
    });
  }

  // ===============================
  // 🟢 プリセットチップ
  // ===============================
  function renderPresets() {
    const area = $("#presetArea");
    area.innerHTML = "";
    (PRESETS[state.activeTab] || []).forEach(text => {
      const chip = document.createElement("button");
      chip.textContent = text;
      chip.onclick = () => {
        const input = $("#userInput");
        input.value += (input.value ? "\n" : "") + text;
      };
      area.appendChild(chip);
    });
  }

  // ===============================
  // 🎤 音声入力
  // ===============================
  function startRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert("音声認識に対応していないブラウザです。Chromeをおすすめします。");
      return;
    }
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'ja-JP';
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      $("#userInput").value = transcript;
    };
    recognition.start();
  }

  // ===============================
  // 🧩 イベント
  // ===============================
  document.addEventListener("DOMContentLoaded", () => {
    renderTabs();
    renderPresets();

    $("#micBtn").addEventListener("click", startRecognition);

    $("#addQuestionBtn").addEventListener("click", () => {
      const activeText = PRESETS[state.activeTab]?.[0] || "";
      if (activeText) {
        const input = $("#userInput");
        input.value += (input.value ? "\n" : "") + activeText;
      }
    });

    // 生成ボタン（AIとの通信部分は元のまま）
    $("#generateBtn").addEventListener("click", async () => {
      const text = $("#userInput").value.trim();
      if (!text) return;
      const res = await fetch("/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text })
      });
      const data = await res.json();
      $("#result").value = data.response || "(応答がありません)";
    });

    $("#clearBtn").addEventListener("click", () => {
      $("#userInput").value = "";
      $("#result").value = "";
    });

    $("#copyResultBtn").addEventListener("click", () => {
      navigator.clipboard.writeText($("#result").value);
      alert("コピーしました");
    });

    $("#saveBtn").addEventListener("click", () => {
      localStorage.setItem("jibunshi_input", $("#userInput").value);
      localStorage.setItem("jibunshi_output", $("#result").value);
      alert("保存しました");
    });

    $("#loadBtn").addEventListener("click", () => {
      $("#userInput").value = localStorage.getItem("jibunshi_input") || "";
      $("#result").value = localStorage.getItem("jibunshi_output") || "";
    });

    $("#downloadTxtBtn").addEventListener("click", () => {
      const blob = new Blob([$("#result").value], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "jibunshi.txt";
      a.click();
      URL.revokeObjectURL(url);
    });
  });
})();
