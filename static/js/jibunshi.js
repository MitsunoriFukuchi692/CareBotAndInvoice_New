(() => {
  const PRESETS = {
    "幼少期": [
      "幼少期の家庭環境（家族構成／暮らしの雰囲気）を温度感が伝わる描写で。",
      "いちばん好きだった遊びと、その時の匂い・音・季節感を書いてください。",
      "祖父母・近所の大人から受けた言葉で、今も残っているものは？"
    ],
    "学生時代": [
      "小中高・大学での部活や打ち込んだこと。挫折と乗り越えを書いてください。",
      "友人関係や先生との出会いが人生観に与えた影響は？",
      "受験や引っ越し等の転機で感じた孤独・希望・決意を具体的に。"
    ],
    "仕事": [
      "初めての就職／起業の動機と、その時の不安・覚悟を書いてください。",
      "仕事で誇れる成果と、その裏にあった工夫・仲間・偶然について。",
      "失敗から学んだ教訓を、未来の自分への助言として。"
    ],
    "家族": [
      "配偶者・子ども・親とのエピソードで、性格や関係性が伝わる場面を。",
      "家族行事（旅行・季節の行事）で印象深い一日を情景描写で。",
      "介護や看取りの経験があれば、当時の心の動きと支えになったもの。"
    ],
    "転機": [
      "人生の分岐点（出会い・病気・転職・移住）での選択と理由を具体的に。",
      "最大のピンチと、それを救った言葉・人・小さな行動について。",
      "価値観が変わった瞬間を、前後の対比で描写してください。"
    ],
    "これから": [
      "これから叶えたいこと（家族・仕事・地域）を宣言文として。",
      "未来の自分へ手紙を書くつもりで、今の想いを素直に。",
      "若い人へ伝えたい、あなたの『やってよかった3つ』。"
    ]
  };

  const $ = (q) => document.querySelector(q);
  const resultEl = $('#result');
  const inputEl = $('#userInput');
  const state = { activeTab: Object.keys(PRESETS)[0], selected: new Set() };

  function flash(el) {
    el.style.outline = '2px solid #93c5fd';
    setTimeout(()=> el.style.outline = 'none', 600);
  }

  // --- タブ ---
  function renderTabs() {
    const wrap = $('#presetTabs');
    wrap.innerHTML = '';
    for (const name of Object.keys(PRESETS)) {
      const b = document.createElement('button');
      b.className = 'tab' + (name === state.activeTab ? ' active' : '');
      b.textContent = name;
      b.onclick = ()=>{ state.activeTab = name; renderPresets(); renderTabs(); };
      wrap.appendChild(b);
    }
  }

  // --- プリセット ---
  function renderPresets() {
    const area = $('#presetArea');
    area.innerHTML = '';
    for (const q of PRESETS[state.activeTab] || []) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = q;
      chip.onclick = ()=> {
        if (state.selected.has(q)) {
          state.selected.delete(q);
          chip.style.background = '#fff';
        } else {
          state.selected.add(q);
          chip.style.background = '#eef2ff';
        }
      };
      area.appendChild(chip);
    }
  }

  $('#addSelected').onclick = ()=> {
    if (state.selected.size === 0) { alert('質問を選んでください'); return; }
    const text = Array.from(state.selected).map(s => `・${s}`).join('\n');
    inputEl.value += (inputEl.value ? '\n' : '') + text;
    state.selected.clear();
    renderPresets();
    flash(inputEl);
  };

  // --- 音声入力 ---
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = false;
    recognition.interimResults = false;

    $('#micBtn').addEventListener('click', () => {
      recognition.start();
      $('#micBtn').textContent = '🎙聞き取り中...';
    });
    recognition.onresult = (e) => {
      inputEl.value += (inputEl.value ? ' ' : '') + e.results[0][0].transcript;
      $('#micBtn').textContent = '🎤 音声入力';
    };
    recognition.onend = () => $('#micBtn').textContent = '🎤 音声入力';
    recognition.onerror = () => $('#micBtn').textContent = '🎤 音声入力';
  } else {
    $('#micBtn').disabled = true;
    $('#micBtn').textContent = '非対応';
  }

  // --- 生成 ---
  async function callGenerateAPI(promptText) {
    for (const ep of ['/generate','/api/generate']) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptText })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.text || data.content || '';
      } catch {}
    }
    throw new Error('API呼び出し失敗');
  }

  async function onGenerate() {
    const prompt = inputEl.value.trim();
    if (!prompt) { alert('質問欄が空です'); return; }
    $('#btnGenerate').disabled = true;
    resultEl.textContent = '生成中…';
    try {
      const out = await callGenerateAPI(prompt);
      resultEl.textContent = out || '(空の結果)';
      localStorage.setItem('jibunshi_output', out);
      flash(resultEl);
    } catch (e) {
      resultEl.textContent = 'エラー：' + e.message;
    } finally {
      $('#btnGenerate').disabled = false;
    }
  }

  $('#btnGenerate').onclick = onGenerate;
  $('#btnClear').onclick = ()=> { inputEl.value=''; flash(inputEl); };

  // --- コピー・保存 ---
  async function copyText(el) {
    const text = (el.value ?? el.textContent) || '';
    await navigator.clipboard.writeText(text);
    flash(el);
  }
  $('#btnCopyPrompt').onclick = ()=> copyText(inputEl);
  $('#btnCopy').onclick = ()=> copyText(resultEl);
  $('#btnSave').onclick = ()=> {
    localStorage.setItem('jibunshi_input', inputEl.value);
    localStorage.setItem('jibunshi_output', resultEl.textContent);
    alert('保存しました');
  };
  $('#btnLoad').onclick = ()=> {
    inputEl.value = localStorage.getItem('jibunshi_input') || '';
    resultEl.textContent = localStorage.getItem('jibunshi_output') || '';
  };
  $('#btnDownload').onclick = ()=> {
    const blob = new Blob([resultEl.textContent], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    a.download = `jibunshi-${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  document.addEventListener('keydown', (e)=>{
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); onGenerate(); }
  });

  renderTabs(); renderPresets();
})();
