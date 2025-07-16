// static/js/chatbot.v3.js - 完全版

// DOM読み込み後に初期化
document.addEventListener("DOMContentLoaded", () => {
  console.log('🚀 chatbot.v3.js loaded');

  // グローバルエラーキャッチ
  window.onerror = (message, source, lineno, colno) => {
    console.error(`Error: ${message} at ${source}:${lineno}:${colno}`);
  };

  // 音声認識設定
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null;
  let activeInput = null;
  if (SpeechRecognition) {
    recog = new SpeechRecognition();
    recog.lang = 'ja-JP';
    recog.interimResults = false;
    recog.addEventListener('start', () => console.log('🔴 Recognition started'));
    recog.addEventListener('end', () => console.log('⚪ Recognition ended'));
    recog.addEventListener('error', e => console.error('SpeechRec Error:', e));
    recog.addEventListener('result', event => {
      const transcript = event.results[0][0].transcript;
      if (activeInput) activeInput.value = transcript;
    });
  }

  // マイク開始関数
  window.startRecognition = (inputId) => {
    if (!recog) {
      alert('音声認識に対応していません');
      return;
    }
    activeInput = document.getElementById(inputId);
    if (!activeInput) return console.error('Input not found:', inputId);
    recog.start();
  };

  // テキスト読み上げ
  function speak(text, lang = 'ja-JP') {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.volume = parseFloat(document.getElementById('volume-slider').value) || 1;
    utter.rate = parseFloat(document.getElementById('rate-slider').value) || 1;
    window.speechSynthesis.speak(utter);
  }

  // メッセージ追加
  const chatWindow = document.getElementById('chat-window');
  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.classList.add('message', role === 'caregiver' ? 'caregiver' : 'caree');
    div.textContent = (role === 'caregiver' ? '介護士: ' : '被介護者: ') + text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  // 送信ボタンハンドラ
  document.getElementById('send-caregiver').addEventListener('click', () => {
    const input = document.getElementById('caregiver-input');
    const txt = input.value.trim();
    if (!txt) return;
    appendMessage('caregiver', txt);
    speak(txt);
    input.value = '';
  });
  document.getElementById('send-caree').addEventListener('click', () => {
    const input = document.getElementById('caree-input');
    const txt = input.value.trim();
    if (!txt) return;
    appendMessage('caree', txt);
    speak(txt);
    input.value = '';
  });

  // テンプレート対話開始
  document.getElementById('template-start-btn').addEventListener('click', () => {
    fetch('/ja/templates')
      .then(res => res.json())
      .then(list => {
        const panel = document.getElementById('template-buttons');
        panel.innerHTML = '';
        list.forEach(item => {
          const btn = document.createElement('button');
          btn.textContent = item.category;
          btn.addEventListener('click', () => showTemplateOptions(item));
          panel.appendChild(btn);
        });
      })
      .catch(e => alert('テンプレート取得失敗'));
  });

  function showTemplateOptions(item) {
    const panel = document.getElementById('template-buttons'); panel.innerHTML = '';
    item.caregiver.forEach(text => {
      const b = document.createElement('button'); b.textContent = text;
      b.addEventListener('click', () => {
        appendMessage('caregiver', text);
        speak(text);
        showCareeOptions(item);
      }); panel.appendChild(b);
    });
  }

  function showCareeOptions(item) {
    const panel = document.getElementById('template-buttons'); panel.innerHTML = '';
    item.caree.forEach(text => {
      const b = document.createElement('button'); b.textContent = text;
      b.addEventListener('click', () => {
        appendMessage('caree', text);
        speak(text);
        panel.innerHTML = '';
      }); panel.appendChild(b);
    });
  }

  // 用語説明
  document.getElementById('explain-btn').addEventListener('click', () => {
    const term = document.getElementById('term').value.trim();
    if (!term) return alert('用語を入力してください');
    fetch('/ja/explain', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({term, maxLength:30})
    })
      .then(res => res.json())
      .then(j => {
        document.getElementById('explanation').textContent = j.explanation;
        speak(j.explanation);
      })
      .catch(() => alert('用語説明失敗'));
  });

    // 翻訳
  document.getElementById('translate-btn').addEventListener('click', () => {
    // 用語説明結果を参照
    const explanation = document.getElementById('explanation').textContent.trim();
    if (!explanation) {
      alert('まず用語説明を実行');
      return;
    }
    const dir = document.getElementById('translate-direction').value;
    fetch('/ja/translate', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ text: explanation, direction: dir })
    })
      .then(res => res.json())
      .then(j => {
        document.getElementById('translation-result').textContent = j.translated;
        // 翻訳結果読み上げ
        speak(j.translated, dir === 'ja-en' ? 'en-US' : 'ja-JP');
      })
      .catch(() => alert('翻訳失敗'));
  });

  // 会話ログ保存
  document.getElementById('save-log-btn').addEventListener('click', () => {
    const lines = Array.from(chatWindow.children).map(d => d.textContent).join('\n');
    fetch('/ja/save_log', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username:'介護士', timestamp:new Date().toISOString(), input:lines, response:''})
    })
      .then(res => res.json())
      .then(j => { if (j.status==='success') alert('保存成功'); else throw j; })
      .catch(() => alert('ログ保存失敗'));
  });

  // 日報生成
  document.getElementById('daily-report-btn').addEventListener('click', () => {
    document.getElementById('save-log-btn').click();
    setTimeout(() => location.href='/ja/daily_report', 500);
  });
});
// static/js/chatbot.v3.js - 完全版

// DOM読み込み後に初期化
document.addEventListener("DOMContentLoaded", () => {
  console.log('🚀 chatbot.v3.js loaded');

  // グローバルエラーキャッチ
  window.onerror = (message, source, lineno, colno) => {
    console.error(`Error: ${message} at ${source}:${lineno}:${colno}`);
  };

  // 音声認識設定
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recog = null;
  let activeInput = null;
  if (SpeechRecognition) {
    recog = new SpeechRecognition();
    recog.lang = 'ja-JP';
    recog.interimResults = false;
    recog.addEventListener('start', () => console.log('🔴 Recognition started'));
    recog.addEventListener('end', () => console.log('⚪ Recognition ended'));
    recog.addEventListener('error', e => console.error('SpeechRec Error:', e));
    recog.addEventListener('result', event => {
      const transcript = event.results[0][0].transcript;
      if (activeInput) activeInput.value = transcript;
    });
  }

  // マイク開始関数
  window.startRecognition = (inputId) => {
    if (!recog) {
      alert('音声認識に対応していません');
      return;
    }
    activeInput = document.getElementById(inputId);
    if (!activeInput) return console.error('Input not found:', inputId);
    recog.start();
  };

  // テキスト読み上げ
  function speak(text, lang = 'ja-JP') {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.volume = parseFloat(document.getElementById('volume-slider').value) || 1;
    utter.rate = parseFloat(document.getElementById('rate-slider').value) || 1;
    window.speechSynthesis.speak(utter);
  }

  // メッセージ追加
  const chatWindow = document.getElementById('chat-window');
  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.classList.add('message', role === 'caregiver' ? 'caregiver' : 'caree');
    div.textContent = (role === 'caregiver' ? '介護士: ' : '被介護者: ') + text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  // 送信ボタンハンドラ
  document.getElementById('send-caregiver').addEventListener('click', () => {
    const input = document.getElementById('caregiver-input');
    const txt = input.value.trim();
    if (!txt) return;
    appendMessage('caregiver', txt);
    speak(txt);
    input.value = '';
  });
  document.getElementById('send-caree').addEventListener('click', () => {
    const input = document.getElementById('caree-input');
    const txt = input.value.trim();
    if (!txt) return;
    appendMessage('caree', txt);
    speak(txt);
    input.value = '';
  });

  // テンプレート対話開始
  document.getElementById('template-start-btn').addEventListener('click', () => {
    fetch('/ja/templates')
      .then(res => res.json())
      .then(list => {
        const panel = document.getElementById('template-buttons');
        panel.innerHTML = '';
        list.forEach(item => {
          const btn = document.createElement('button');
          btn.textContent = item.category;
          btn.addEventListener('click', () => showTemplateOptions(item));
          panel.appendChild(btn);
        });
      })
      .catch(e => alert('テンプレート取得失敗'));
  });

  function showTemplateOptions(item) {
    const panel = document.getElementById('template-buttons'); panel.innerHTML = '';
    item.caregiver.forEach(text => {
      const b = document.createElement('button'); b.textContent = text;
      b.addEventListener('click', () => {
        appendMessage('caregiver', text);
        speak(text);
        showCareeOptions(item);
      }); panel.appendChild(b);
    });
  }

  function showCareeOptions(item) {
    const panel = document.getElementById('template-buttons'); panel.innerHTML = '';
    item.caree.forEach(text => {
      const b = document.createElement('button'); b.textContent = text;
      b.addEventListener('click', () => {
        appendMessage('caree', text);
        speak(text);
        panel.innerHTML = '';
      }); panel.appendChild(b);
    });
  }

  // 用語説明
  document.getElementById('explain-btn').addEventListener('click', () => {
    const term = document.getElementById('term').value.trim();
    if (!term) return alert('用語を入力してください');
    fetch('/ja/explain', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({term, maxLength:30})
    })
      .then(res => res.json())
      .then(j => {
        document.getElementById('explanation').textContent = j.explanation;
        speak(j.explanation);
      })
      .catch(() => alert('用語説明失敗'));
  });

    // 翻訳
  document.getElementById('translate-btn').addEventListener('click', () => {
    // 用語説明結果を参照
    const explanation = document.getElementById('explanation').textContent.trim();
    if (!explanation) {
      alert('まず用語説明を実行');
      return;
    }
    const dir = document.getElementById('translate-direction').value;
    fetch('/ja/translate', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ text: explanation, direction: dir })
    })
      .then(res => res.json())
      .then(j => {
        document.getElementById('translation-result').textContent = j.translated;
        // 翻訳結果読み上げ
        speak(j.translated, dir === 'ja-en' ? 'en-US' : 'ja-JP');
      })
      .catch(() => alert('翻訳失敗'));
  });

  // 会話ログ保存
  document.getElementById('save-log-btn').addEventListener('click', () => {
    const lines = Array.from(chatWindow.children).map(d => d.textContent).join('\n');
    fetch('/ja/save_log', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username:'介護士', timestamp:new Date().toISOString(), input:lines, response:''})
    })
      .then(res => res.json())
      .then(j => { if (j.status==='success') alert('保存成功'); else throw j; })
      .catch(() => alert('ログ保存失敗'));
  });

  // 日報生成
  document.getElementById('daily-report-btn').addEventListener('click', () => {
    document.getElementById('save-log-btn').click();
    setTimeout(() => location.href='/ja/daily_report', 500);
  });
});
