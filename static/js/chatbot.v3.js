/*
  chatbot.v3.js — 完全版（2025-09-11）
  - 介護支援ボット側の挙動に影響を与えない “最小パッチ” 方針
  - 翻訳学習／観光案内ページの課題を重点修正：
      1) 翻訳テキストが出ない／遅い → 失敗時もUIに状態を表示
      2) 音声が出ない／日本語が外国人訛りになる → 言語別の厳密な声選択＆フォールバック
      3) タガログ語（tl/fil）表記ブレ対策
  - 既存のUI・テンプレ・マイク処理・イベント監視は触らない設計

  ※ このファイルは単体で読み込み可能なように防御的に実装しています。
  ※ 既存コードから呼ばれている可能性が高い関数名：
      - speakSmart(text, langBCP)
      - translateAndSpeak(text, direction)
    上記はグローバルに残しつつ、内部の改善ロジックへ委譲します。
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
    // UI/サーバ間のゆるいマッピング（必要最低限）。
    // 例：{ ja: 'ja-JP', en: 'en-US', vi: 'vi-VN', tl: 'tl-PH' }
    bcpMap: { ja: 'ja-JP', en: 'en-US', vi: 'vi-VN', tl: 'tl-PH' },

    // タガログ語の fil/tl 揺れを吸収
    normalize(bcp){
      if (!bcp) return 'ja-JP';
      const lc = String(bcp).trim();
      if (lc === 'fil-PH') return 'tl-PH';
      // 大文字・小文字表記を正規化
      try {
        const [lang, region] = lc.split('-');
        return region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase();
      } catch { return lc; }
    },

    // 翻訳APIの応答から最終的にTTSで使うBCPに落とす
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
      // Safari/Chrome で getVoices() が即時0件のことがある → ポーリング
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
      // 日本語は “日本/ja-JP” を含む声を優先（環境差吸収）
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
  // サーバTTS → 失敗時ブラウザにフォールバック
  //============================================
  async function speakSmart(text, langBCP){
    if (!text) return;
    langBCP = Lang.normalize(langBCP || 'ja-JP');

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
        // 念のための自動解放
        setTimeout(()=>URL.revokeObjectURL(url), 15000);
        return;
      }
    }catch(e){ /* ネットワーク等の失敗は無視してブラウザへ */ }

    // ブラウザの声で読む（日本語はここでもネイティブ声）
    try{
      await TTS.speakBrowser(text, langBCP);
    }catch(e){ /* ここで失敗したら諦める（UI側で表示は行う） */ }
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
      // APIの応答キー差異に広めに対応
      const translated = j?.text || j?.translated || j?.result || '';
      if (out) out.textContent = translated || '(翻訳なし)';

      if (translated){
        const langBCP = Lang.decideFromDirectionOrResp(direction, j);
        await speakSmart(translated, langBCP);
      }
    }catch(e){
      console.error(e);
      if (out) out.textContent = '翻訳に失敗しました';
    }
  }

  //============================================
  // （任意）初期化ヘルパ：ページ読込時に音声リストのウォームアップ
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
  window.speakSmart = speakSmart;            // 既存互換
  window.translateAndSpeak = translateAndSpeak; // 既存互換
  window.__TTS_DEBUG = { TTS, Lang };        // デバッグ用（必要なら）
})();
