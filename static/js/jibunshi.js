// ==========================
// 📝 自分史用プリセット（章番号付き）
// ==========================

// build 2025-10-16-2
console.log('JIBUNSHI BUILD 2025-10-16-1');
// ----------------------

const PRESETS = [
  {
    label: "生い立ち",
    prompt: "私は西暦（　）年（　）月（　）日、（　）県（　）市で生まれました。幼少期の思い出や家族との暮らし、当時の様子を400字で書いてください。"
  },
  {
    label: "学生時代",
    prompt: "私は（　）学校に通っていた頃、（　）という出来事がありました。そのときの状況や気持ち、学んだことを400字で書いてください。"
  },
  {
    label: "仕事",
    prompt: "私は（　）年に（　）という仕事を始めました。その仕事を選んだ理由、苦労や転機になった出来事を400字で書いてください。"
  },
  {
    label: "家族",
    prompt: "私の家族には（　）がいます。印象に残っている家族との思い出や出来事を400字で書いてください。"
  },
  {
    label: "転機",
    prompt: "私の人生の転機は（　）でした。そのときに起こったこと、考えたこと、そこから得たものを400字で書いてください。"
  },
  {
    label: "これから",
    prompt: "これまでの経験をふまえて、これからの人生でやってみたいこと、伝えたいことを400字で書いてください。"
  },
];

let chapterCount = 0; // 章番号カウンタ
let selectedPresets = new Set(); // 選択されたプリセットを記録

// ==========================
// 🟦 タブとプリセットボタン描画
// ==========================
function renderPresetUI() {
  const tabBox = document.getElementById("presetTabs");
  const chipBox = document.getElementById("presetArea");
  tabBox.innerHTML = "";
  chipBox.innerHTML = "";

  PRESETS.forEach((p, idx) => {
    // タブボタン
    const tab = document.createElement("div");
    tab.className = "tab";
    tab.textContent = p.label;
    tab.onclick = () => togglePreset(idx);
    tabBox.appendChild(tab);

    // チップ
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = p.label;
    chip.onclick = () => togglePreset(idx);
    chipBox.appendChild(chip);
  });
}

// ==========================
// 🟡 プリセット選択トグル
// ==========================
function togglePreset(idx) {
  if (selectedPresets.has(idx)) {
    selectedPresets.delete(idx);
  } else {
    selectedPresets.add(idx);
  }
  updatePresetHighlight();
}

// ==========================
// 🟠 選択状態の見た目更新
// ==========================
function updatePresetHighlight() {
  const tabs = document.querySelectorAll("#presetTabs .tab");
  const chips = document.querySelectorAll("#presetArea .chip");
  tabs.forEach((el, i) => {
    el.classList.toggle("active", selectedPresets.has(i));
  });
  chips.forEach((el, i) => {
    el.style.background = selectedPresets.has(i) ? "#e0eaff" : "#fff";
  });
}

// ==========================
// 🟩 選択されたプリセットを質問欄に追加
// ==========================
function addSelectedPresetsToInput() {
  const input = document.getElementById("userInput");
  let baseText = input.value.trim();
  selectedPresets.forEach((idx) => {
    chapterCount++;
    const title = `第${chapterCount}章 ${PRESETS[idx].label}`;
    const textBlock = `${title}\n${PRESETS[idx].prompt}`;
    baseText += (baseText ? "\n\n" : "") + textBlock;
  });
  input.value = baseText;
  input.focus();

  if (document.getElementById("autoRun").checked && selectedPresets.size > 0) {
    generateText();
  }

  selectedPresets.clear();
  updatePresetHighlight();
}

// ==========================
// 🧠 AI 生成
// ==========================
async function generateText() {
  const userInput = document.getElementById("userInput").value.trim();
  if (!userInput) return;

  const resultDiv = document.getElementById("result");
  resultDiv.textContent = "生成中…";

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: userInput }),
    });
    const data = await res.json();
    if (data.text) {
      resultDiv.textContent = data.text;
    } else {
      resultDiv.textContent = "エラー: " + (data.error || "不明なエラー");
    }
  } catch (err) {
    resultDiv.textContent = "通信エラー: " + err;
  }
}

// ==========================
// 🧹 クリア
// ==========================
function clearAll() {
  document.getElementById("userInput").value = "";
  document.getElementById("result").textContent = "";
  selectedPresets.clear();
  updatePresetHighlight();
}

// ==========================
// 🧩 イベント登録
// ==========================
document.addEventListener("DOMContentLoaded", () => {
  renderPresetUI();

  document.getElementById("addSelected").addEventListener("click", addSelectedPresetsToInput);
  document.getElementById("btnGenerate").addEventListener("click", generateText);
  document.getElementById("btnClear").addEventListener("click", clearAll);

  // Ctrl+Enterで生成
  document.getElementById("userInput").addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") {
      generateText();
    }
  });
});
