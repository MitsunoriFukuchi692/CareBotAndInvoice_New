document.addEventListener('DOMContentLoaded', () => {
  // 要素取得
  const voiceBtn      = document.getElementById('voice-btn');
  const sendBtn       = document.getElementById('send-btn');
  const inputField    = document.getElementById('chat-input');
  const chatContainer = document.getElementById('chat-container');
  const ttsPlayer     = document.getElementById('tts-player');
  const tplContainer  = document.getElementById('template-container');
  const explainInput  = document.getElementById('explain-input');
  const explainBtn    = document.getElementById('explain-btn');

  console.log(
    'voiceBtn=', voiceBtn,
    'sendBtn=', sendBtn,
    'inputField=', inputField,
    'chatContainer=', chatContainer,
    'ttsPlayer=', ttsPlayer,
    'tplContainer=', tplContainer,
    'explainInput=', explainInput,
    'explainBtn=', explainBtn
  );

  // --------- テンプレート取得＆描画 ---------
  fetch('/templates')
    .then(res => res.json())
    .then(list => {
      list.forEach(cat => {
        const group = document.createElement('div');
        group.style.marginBottom = '4px';
        const label = document.createElement('strong');
        label.textContent = cat.category + ': ';
        group.appendChild(label);

        cat.phrases.forEach(text => {
          const btn = document.createElement('button');
          btn.textContent = text;
          btn.style.margin = '2px';
          btn.onclick = () => {
            inputField.value = text;
            inputField.focus();
          };
          group.appendChild(btn);
        });

        tplContainer.appendChild(group);
      });
    })
    .catch(err => console.error('templates load error', err));

  // --------- 音声認識のセットアップ ---------
  let recog = null;
  if (window.SpeechRecognition || window.webkitSpeechRecognition) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recog = new SR();
    recog.lang = 'ja-JP';
    recog.onresult = e => {
      inputField.value = e.results[0][0].transcript;
    };
    recog.onerror = e => console.error('認識エラー', e);
  } else {
    voiceBtn.style.display = 'none';
  }
  voiceBtn.addEventListener('click', () => {
    if (recog) recog.start();
  });

  // --------- チャット送信＆TTS ---------
  async function sendMessage() {
    const text = inputField.value.trim();
    if (!text) return;

    // AudioContext 再開
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      try {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') await ctx.resume();
      } catch (e) {
        console.warn('AudioContext resume failed', e);
      }
    }

    appendMessage('user', text);
    inputField.value = '';

    // Chat API 呼び出し
    let botReply = '';
    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      console.log('chat response:', data);
      botReply = data.reply || data.message || data.choices?.[0]?.message?.content || '';
    } catch (err) {
      console.error('チャットAPIエラー', err);
      botReply = 'すみません、エラーが発生しました。';
    }

    appendMessage('bot', botReply);

    // TTS 再生
    try {
      console.log('TTS 呼び出し:', botReply);
      const audioUrl = await callTTS(botReply, 'ja');
      ttsPlayer.src = audioUrl;
      await ttsPlayer.play();
    } catch (err) {
      console.error('TTS再生エラー', err);
    }
  }
  sendBtn.addEventListener('click', sendMessage);
  inputField.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendMessage();
  });

  // --------- 用語説明 ---------
  explainBtn.addEventListener('click', async () => {
    const term = explainInput.value.trim();
    if (!term) return alert('用語を入力してください');
    try {
      const base = window.location.origin;  // 例: "https://kigosienchatbot-0621-27.onrender.com"
      const res = await fetch(`${base}/explain`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({term})
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      appendMessage('bot', `［用語説明］「${term}」とは…\n${data.explanation}`);
      explainInput.value = '';
    } catch (e) {
      console.error('用語説明エラー', e);
      alert('説明取得に失敗しました');
    }
  });

  // --------- DOM にメッセージを追加（アイコン付き） ---------
  function appendMessage(who, text) {
    const wrap = document.createElement('div');
    wrap.className = `chat ${who}`;

    const icon = document.createElement('span');
    icon.className = 'avatar';
    icon.textContent = who === 'user' ? '👩‍⚕️' : '👴';

    const messageText = document.createElement('span');
    messageText.className = 'message-text';
    messageText.textContent = text;

    wrap.appendChild(icon);
    wrap.appendChild(messageText);
    chatContainer.appendChild(wrap);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // --------- TTS 関数 ---------
  async function callTTS(text, lang = 'ja') {
    const res = await fetch('/tts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ text, lang }),
    });
    if (!res.ok) throw new Error(`TTS API エラー ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
});
