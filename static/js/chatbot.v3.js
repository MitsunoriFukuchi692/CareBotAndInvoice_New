/*
  chatbot.v3.js — 完全版（2025-09-11 修正版）
  - 介護支援ボットに影響を与えない “最小パッチ”
  - 改善点：
      1) 日本語を必ず日本語ボイスで読み上げ（訛り回避）
      2) /tts 失敗時はブラウザTTSへ確実にフォールバック
      3) タガログ語 fil/tl の表記ブレ吸収
      4) 翻訳APIの返却キー差異を広く許容
      5) 初回再生ブロック対策（クリックでアンロック）
*/

(function(){
  'use strict';

  //============================================
  // 小ユーティリティ
  //============================================
  const $ = (sel) => document.getElementById(sel) || document.querySelector(sel);
  const sleep = (ms) => new Promise(r=>setTimeout(r, ms));

  //============================================
  // 言語コード関連（BCP 47） & 正規化
  //============================================
  const Lang = {
    // 代表的なマップ（必要最低限）
    bcpMap: { ja: 'ja-JP', en: 'en-US', vi: 'vi-VN', tl: 'tl-PH' },

    // タガログ語の fil/tl 揺れを吸収して正規化
    normalize(bcp){
      if (!bcp) return 'ja-JP';
      const lc = String(bcp).trim();
      if (lc === 'fil-PH') return 'tl-PH';
      try {
        const [lang, region] = lc.split('-');
        return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
      } catch { return lc; }
    },

    // 翻訳方向またはAPI返答から最終BCPを決定
    decideFromDirectionOrResp(direction, resp){
      if (resp && typeof resp.lang === 'string') return Lang.normalize(resp.lang);
      if (resp && typeof resp.targetLang === 'string') return Lang.normalize(resp.targetLang);
      switch(direction){
        case 'JA2EN': return 'en-US';
        case 'EN2JA': return 'ja-JP';
        case 'JA2VI': return 'vi-VN';
        case 'VI2JA': return 'ja-JP';
        case 'JA2TL': return 'tl-PH';
        case 'TL2JA': return 'ja-JP';
        default: return 'ja-JP';
      }
    }
  };

  //============================================
  // ブラウザTTS（SpeechSynthesis）安定化
  //============================================
  const TTS = (function(){
    let VOICES = [];
    let voicesLoaded = false;

    async function loadVoicesOnce(){
      if (voicesLoaded && VOICES.length) return VOICES;
      // getVoices() が 0 件を返す場合があるためポーリング
      for (let i=0; i<25; i++){
        VOICES = (window.speechSynthesis && window.speechSynthesis.getVoices) ? window.speechSynthesis.getVoices() : [];
        if (VOICES && VOICES.length){ voicesLoaded = true; return VOICES; }
        await sleep(120);
      }
      voicesLoaded = true;
      return VOICES;
    }

    function pickVoiceByLang(langBCP){
      if (!VOICES || !VOICES.length) return null;
      const lc = (langBCP||'').toLowerCase();
      // 完全一致
      let v = VOICES.find(v => (v.lang||'').toLowerCase() === lc);
      if (v) return v;
      // 言語コード一致（ja, en, vi, tl など）
      const short = lc.split('-')[0];
      v = VOICES.find(v => (v.lang||'').toLowerCase().startsWith(short));
      if (v) return v;
      // 日本語は "日本"/ja-JP を含む声を優先（環境差吸収）
      if (short === 'ja'){
        v = VOICES.find(v => /日本|ja-JP/i.test(`${v.name} ${v.lang}`));
        if (v) return v;
      }
      return VOICES[0] || null;
    }

    async function speakBrowser(text, langBCP){
      if (!text) return;
      await loadVoicesOnce();
      const v = pickVoiceByLang(langBCP);
      return new Promise((resolve, reject)=>{
        try{
          window.speechSynthesis && window.speechSynthesis.cancel && window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          if (v) u.voice = v;
          u.lang = (v && v.lang) ? v.lang : langBCP;
          u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
          u.onend = resolve;
          u.onerror = (e)=>reject(e.error||e);
          window.speechSynthesis.speak(u);
        }catch(e){ reject(e); }
      });
    }

    return { loadVoicesOnce, speakBrowser, pickVoiceByLang };
  })();

  //============================================
  // 初回再生ブロック対策（クリック一発でアンロック）
  //============================================
  (function setupAudioUnlock(){
    let unlocked=false;
    function unlock(){
      if(unlocked) return;
      try{
        if (window.speechSynthesis){
          const u = new SpeechSynthesisUtterance(' ');
          u.volume = 0; window.speechSynthesis.speak(u);
        }
      }catch{}
      unlocked=true; window.removeEventListener('click', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
    }
    window.addEventListener('click', unlock, true);
    window.addEventListener('touchstart', unlock, true);
  })();

  //============================================
  // サーバTTS → 失敗時ブラウザにフォールバック
  //============================================
  async function speakSmart(text, langBCP){
    if (!text) return;
    langBCP = Lang.normalize(langBCP || 'ja-JP');

    // 日本語は必ずブラウザTTSで読む（訛り回避 & 介護支援ボット安定）
    if (!langBCP || String(langBCP).toLowerCase().startsWith('ja')){
      try { await TTS.speakBrowser(text, 'ja-JP'); return; } catch(_){ /* 失敗時は下へ */ }
    }

    try{
      const r = await fetch('/tts',{
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ text, lang: langBCP })
      });
      if (r.ok){
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        a.playsInline = true;
        await a.play().catch(()=>{});
        a.onended = () => URL.revokeObjectURL(url);
        setTimeout(()=>URL.revokeObjectURL(url), 15000);
        return;
      }
    }catch(_){ /* ネットワーク等の失敗は無視して次へ */ }

    // 最後の砦：ブラウザの声で読む
    try{ await TTS.speakBrowser(text, langBCP); }catch(_){ }
  }

  //============================================
  // 翻訳 → 表示 → 発声
  //============================================
  async function translateAndSpeak(text, direction, opts={}){
    if (!text) return;
    const out = opts.outputElId ? $(opts.outputElId) : $(opts.outputSel) || $('#tx-out');
    if (out) out.textContent = '翻訳中…';

    try{
      const r = await fetch('/ja/translate',{
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ text, direction })
      });
      if (!r.ok) throw new Error('translate '+r.status);
      const j = await r.json();

      // 応答JSONから翻訳文字列を幅広く拾う（キー揺れ対策）
      const translated =
        j?.text ?? j?.translated ?? j?.result ?? j?.translation
        ?? j?.data?.translatedText ?? j?.data?.translations?.[0]?.translatedText ?? '';

      if (out) out.textContent = translated || '(翻訳なし)';

      if (translated){
        let langBCP = Lang.decideFromDirectionOrResp(direction, j);
        // TL/fil 揺れ & vi 安定化
        if (langBCP && langBCP.toLowerCase() === 'fil-ph') langBCP = 'tl-PH';
        if (/^vi/i.test(langBCP)) langBCP = 'vi-VN';
        if (/^tl/i.test(langBCP) || /^fil/i.test(langBCP)) langBCP = 'tl-PH';
        await speakSmart(translated, langBCP);
      }
    }catch(e){
      console.error(e);
      if (out) out.textContent = '翻訳に失敗しました';
    }
  }

  //============================================
  // 初期化：ページ読込時にボイス一覧をウォームアップ
  //============================================
  async function warmupVoices(){
    try{ await TTS.loadVoicesOnce(); }catch{}
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', warmupVoices);
  } else {
    warmupVoices();
  }

  //============================================
  // グローバル公開（既存呼び出し元との互換維持）
  //============================================
  window.speakSmart = speakSmart;                // 既存互換
  window.translateAndSpeak = translateAndSpeak;  // 既存互換
  window.__TTS_DEBUG = { TTS, Lang };            // 任意のデバッグ用
})();
