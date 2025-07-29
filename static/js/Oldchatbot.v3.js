// chatbot.v3.js
document.addEventListener("DOMContentLoaded", () => {
  console.log('🚀 chatbot.v3.js loaded');

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = SpeechRecognition ? new SpeechRecognition() : null;
  if (recog) {
    recog.lang = 'ja-JP';
    recog.interimResults = false;
    recog.onresult = event => {
      const transcript = event.results[0][0].transcript;
      if (window.activeInput) window.activeInput.value = transcript;
    };
  }

  window.startRecognition = (id) => {
    if (!recog) return alert("音声認識に未対応");
    window.activeInput = document.getElementById(id);
    recog.start();
  };

  function speak(text, lang = 'ja-JP') {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.volume = parseFloat(document.getElementById('volume-slider').value) || 1;
    u.rate = parseFloat(document.getElementById('rate-slider').value) || 1;
    speechSynthesis.speak(u);
  }

  const chatWindow = document.getElementById("chat-window");
  function appendMessage(role, text) {
    const div = document.createElement("div");
    div.classList.add("message", role);
    div.textContent = (role === "caregiver" ? "介護士: " : "被介護者: ") + text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  document.getElementById("send-caregiver").onclick = () => {
    const input = document.getElementById("caregiver-input");
    if (!input.value.trim()) return;
    appendMessage("caregiver", input.value.trim());
    speak(input.value.trim());
    input.value = "";
  };

  document.getElementById("send-caree").onclick = () => {
    const input = document.getElementById("caree-input");
    if (!input.value.trim()) return;
    appendMessage("caree", input.value.trim());
    speak(input.value.trim());
    input.value = "";
  };

  document.getElementById("template-start-btn").onclick = () => {
    fetch("/ja/templates")
      .then(r => r.json())
      .then(list => {
        const panel = document.getElementById("template-buttons");
        panel.innerHTML = "";
        list.forEach(item => {
          const btn = document.createElement("button");
          btn.textContent = item.category;
          btn.onclick = () => showTemplateOptions(item);
          panel.appendChild(btn);
        });
      });
  };

  function showTemplateOptions(item) {
    const panel = document.getElementById("template-buttons");
    panel.innerHTML = "";
    item.caregiver.forEach(text => {
      const b = document.createElement("button");
      b.textContent = text;
      b.onclick = () => {
        appendMessage("caregiver", text);
        speak(text);
        showCareeOptions(item);
      };
      panel.appendChild(b);
    });
  }

  function showCareeOptions(item) {
    const panel = document.getElementById("template-buttons");
    panel.innerHTML = "";
    item.caree.forEach(text => {
      const b = document.createElement("button");
      b.textContent = text;
      b.onclick = () => {
        appendMessage("caree", text);
        speak(text);
        panel.innerHTML = "";
      };
      panel.appendChild(b);
    });
  }
});
