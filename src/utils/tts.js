// ==================================
// File: src/utils/tts.js  (drop-in)
// Robust playback: WebAudio -> <audio>
// ==================================
let _ctx = null;
function getCtx() {
  if (_ctx) return _ctx;
  try {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { _ctx = null; }
  return _ctx;
}
export async function unlockAudio() {
  const ctx = getCtx();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch {}
  }
  return ctx.state === 'running';
}
export async function beep(freq = 880, ms = 120) {
  const ctx = getCtx();
  if (!ctx) return;
  try { await ctx.resume(); } catch {}
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.value = 0.0001;
  o.connect(g).connect(ctx.destination);
  o.start();
  g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
  g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
  o.stop(ctx.currentTime + (ms + 50) / 1000);
}

export function hasWebVoices() {
  try { return (window.speechSynthesis?.getVoices?.() || []).length > 0; } catch { return false; }
}
export async function listVoices({ langPrefix = '' } = {}) {
  const ensure = () => new Promise((res) => {
    const v = window.speechSynthesis?.getVoices?.() || [];
    if (v.length) return res(v);
    const t = setInterval(() => {
      const w = window.speechSynthesis?.getVoices?.() || [];
      if (w.length) { clearInterval(t); res(w); }
    }, 150);
    setTimeout(() => { clearInterval(t); res([]); }, 2000);
  });
  const all = await ensure();
  return langPrefix ? all.filter(v => v.lang?.toLowerCase?.().startsWith(langPrefix.toLowerCase())) : all;
}

// Dispatch VU events so avatar can lip-sync
function ttsActivity(active) {
  window.dispatchEvent(new CustomEvent('hb-tts-activity', { detail: { active } }));
}
function ttsLevel(level) {
  window.dispatchEvent(new CustomEvent('hb-tts-level', { detail: { level } }));
}

// Try WebAudio first; if anything fails, fall back to <audio>
async function playArrayBuffer(ab, mime = 'audio/mpeg') {
  if (!ab || ab.byteLength === 0) throw new Error('empty audio buffer');
  const ctx = getCtx();
  try {
    await ctx?.resume?.();
    const buf = await ctx.decodeAudioData(ab.slice(0));
    const src = ctx.createBufferSource();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const data = new Uint8Array(analyser.frequencyBinCount);

    src.buffer = buf;
    const gain = ctx.createGain();
    src.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 1;

    ttsActivity(true);
    const raf = () => {
      analyser.getByteTimeDomainData(data);
      // rough amplitude
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += Math.abs(v);
      }
      ttsLevel(Math.min(1, sum / data.length * 2.5));
      if (_ctx && _ctx.state === 'running') requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);

    return await new Promise((resolve) => {
      src.onended = () => { ttsActivity(false); ttsLevel(0); resolve(); };
      src.start();
    });
  } catch (e) {
    // Fallback: blob -> <audio>
    try {
      const blob = new Blob([ab], { type: mime });
      const url = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        const a = new Audio(url);
        a.onended = () => { URL.revokeObjectURL(url); resolve(); };
        a.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
        a.play().catch(reject);
      });
      return;
    } catch (e2) {
      throw e2;
    }
  }
}

// Main entry used by Conversation.jsx
export async function speakLine({
  text, lang = 'en-US',
  voiceUri,
  voiceHint,
  rate = 1.0,
  tokens,
  onBoundaryTokenIndex,
  onStart, onEnd, onError,
  serverTts = { enabled: false, allowFallback: true },
  openaiVoice = 'alloy',
  openaiModel = 'tts-1',
}) {
  try {
    await unlockAudio();
    onStart && onStart();

    // Server route preferred?
    if (serverTts.enabled) {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: openaiVoice, model: openaiModel, lang })
      });
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        if (!serverTts.allowFallback) throw new Error(`server tts failed: ${r.status} ${err}`);
      } else {
        const ab = await r.arrayBuffer();
        await playArrayBuffer(ab, 'audio/mpeg');
        onEnd && onEnd();
        return;
      }
    }

    // Browser TTS fallback
    const synth = window.speechSynthesis;
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = lang;
    utt.rate = rate;
    if (voiceUri) {
      const voices = synth.getVoices();
      utt.voice = voices.find(v => v.voiceURI === voiceUri) ||
                  voices.find(v => voiceHint?.test?.(v.name) || voiceHint?.test?.(v.lang));
    }
    const tokenList = Array.isArray(tokens) ? tokens : [];
    if (tokenList.length) {
      utt.addEventListener('boundary', (e) => {
        if (e.name === 'word' || e.charLength > 0) {
          const idx = Math.min(tokenList.length - 1, (onBoundaryTokenIndex ? e.charIndex : 0));
          onBoundaryTokenIndex && onBoundaryTokenIndex(idx);
        }
      });
    }
    await new Promise((resolve, reject) => {
      utt.onend = resolve;
      utt.onerror = reject;
      synth.speak(utt);
    });
    onEnd && onEnd();
  } catch (e) {
    onError && onError(e);
    throw e;
  }
}
