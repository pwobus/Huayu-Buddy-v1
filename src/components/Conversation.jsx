// File: src/components/Conversation.jsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useConversationStore } from '../store/useConversationStore';
import useMicVolume from '../hooks/useMicVolume';
import RealtimePanel from './RealtimePanel';
import SettingsDrawer from './SettingsDrawer';
import {
  speakLine as speakLineTTS,
  hasWebVoices,
  listVoices,
  unlockAudio,
  beep,
} from '../utils/tts';

// --- UI bits ---
function Pill({ label, state }) {
  const cls = state === 'ok' ? 'bg-emerald-100 text-emerald-800'
    : state === 'warn' ? 'bg-amber-100 text-amber-800'
    : state === 'fail' ? 'bg-red-100 text-red-800'
    : 'bg-gray-100 text-gray-700';
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}
function Toasts({ toasts }) {
  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id}
          className={`pointer-events-auto px-3 py-2 rounded shadow text-sm text-white ${
            t.type === 'error' ? 'bg-red-600' : t.type === 'warn' ? 'bg-amber-600' : 'bg-gray-900'
          }`}>{t.msg}</div>
      ))}
    </div>
  );
}
function TtsVu() {
  const [amp, setAmp] = useState(0);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onAmp = (e) => setAmp(Number(e?.detail?.level ?? 0));
    const onAct = (e) => setActive(Boolean(e?.detail?.active));
    window.addEventListener('hb-tts-level', onAmp);
    window.addEventListener('hb-tts-activity', onAct);
    return () => {
      window.removeEventListener('hb-tts-level', onAmp);
      window.removeEventListener('hb-tts-activity', onAct);
    };
  }, []);
  const pct = Math.round(Math.min(1, amp) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-600">TTS</span>
      <div className="w-40 h-2 bg-gray-200 rounded overflow-hidden">
        <div className="h-2" style={{ width: `${pct}%`, background: active ? 'linear-gradient(90deg,#2563eb,#60a5fa)' : '#9ca3af' }} />
      </div>
      <span className="text-xs text-gray-600 w-10 text-right">{pct}%</span>
    </div>
  );
}

// --- helpers ---
function formatVocab(list) {
  return list
    .slice(0, 80)
    .map((v) => {
      const h = (v?.hanzi ?? '').trim();
      const p = (v?.pinyin ?? '').trim();
      return h && p ? `${h}(${p})` : (h || p);
    })
    .filter(Boolean)
    .join(', ');
}
function parseTutorReply(raw, showEnglish) {
  const safe = (raw ?? '').toString();
  let hanzi = '', pinyin = '', english = '';
  const lines = safe.split('\n').map((l) => (l ?? '').trim());
  for (const l of lines) {
    if (/^Hanzi\s*:/i.test(l)) hanzi = l.replace(/^Hanzi\s*:\s*/i, '').trim();
    else if (/^Pinyin\s*:/i.test(l)) pinyin = l.replace(/^Pinyin\s*:\s*/i, '').trim();
    else if (/^English\s*:/i.test(l)) english = l.replace(/^English\s*:\s*/i, '').trim();
  }
  if (!hanzi && lines[0]) hanzi = lines[0];
  if (!pinyin && lines[1]) pinyin = lines[1];
  if (showEnglish && !english && lines[2]) english = lines[2];
  return { hanzi, pinyin, english };
}
async function ensurePinyinFromServer(hanzi, model) {
  try {
    const r = await fetch('/api/pinyin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: hanzi || '', model }),
    });
    if (!r.ok) return '';
    const j = await r.json();
    return (j?.pinyin || '').trim();
  } catch { return ''; }
}
async function transcribeBlobToText(blob, { language = 'zh', model = 'gpt-4o-mini-transcribe' } = {}) {
  const fd = new FormData();
  fd.append('file', blob, 'audio.webm');
  fd.append('language', language);
  fd.append('model', model);
  const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
  if (!r.ok) throw new Error('transcribe failed');
  const j = await r.json();
  return (j?.text || '').trim();
}

// ---- OpenAI voice guard (server now rejects verse/aria, etc.) ----
const OPENAI_ALLOWED_VOICES = ['nova','shimmer','echo','onyx','fable','alloy','ash','sage','coral'];
function sanitizeVoice(v) {
  return OPENAI_ALLOWED_VOICES.includes((v || '').toLowerCase()) ? v : 'alloy';
}

export default function Conversation() {
  const { vocabulary, userResponse, setUserResponse, addToHistory, setIsSpeaking } =
    useConversationStore();

  const [drawerOpen, setDrawerOpen] = useState(false);

  const [status, setStatus] = useState({ voices: 0, server: 'checking', stt: 'auto' });
  const [config, setConfig] = useState({
    chatModel: 'gpt-4o-mini',
    sttModel: 'gpt-4o-mini-transcribe',
    ttsModel: 'tts-1',
    realtimeModel: 'gpt-4o-mini-realtime-preview'
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const j = await fetch('/api/config').then(r => r.json());
        if (!alive) return;
        setConfig(j);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  // Models
  const [chatModel, setChatModel] = useState(() => localStorage.getItem('hb_chatModel') || 'gpt-4o-mini');
  const [sttModel, setSttModel]   = useState(() => localStorage.getItem('hb_sttModel')  || 'gpt-4o-mini-transcribe');
  const [ttsModel, setTtsModel]   = useState(() => localStorage.getItem('hb_ttsModel')  || 'tts-1');
  useEffect(() => { try { localStorage.setItem('hb_chatModel', chatModel); } catch {} }, [chatModel]);
  useEffect(() => { try { localStorage.setItem('hb_sttModel', sttModel); } catch {} }, [sttModel]);
  useEffect(() => { try { localStorage.setItem('hb_ttsModel', ttsModel); } catch {} }, [ttsModel]);

  // Chat history
  const [messages, setMessages] = useState([
    {
      role: 'system',
      content:
        'You are a friendly Mandarin tutor. You MUST reply in EXACTLY these lines:\n' +
        'Hanzi: <one short sentence, ≤15 chars>\n' +
        'Pinyin: <matching tone-marked pinyin>\n' +
        'English: <one concise gloss> (omit this line if the student disabled English)\n' +
        'Avoid punctuation beyond basic commas/periods. Use A1 words, short sentences.',
    },
  ]);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // UI toggles
  const [showEnglish, setShowEnglish] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hb_showEnglish') ?? 'true'); } catch { return true; }
  });
  const [speakSlow, setSpeakSlow] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hb_speakSlow') ?? 'false'); } catch { return false; }
  });
  const [speakEnglish, setSpeakEnglish] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hb_speakEnglish') ?? 'false'); } catch { return false; }
  });
  const [speakEnglishDelay, setSpeakEnglishDelay] = useState(() => {
    const v = Number(localStorage.getItem('hb_speakEnglishDelay') ?? '0');
    return Number.isFinite(v) ? Math.max(0, Math.min(2000, v)) : 0;
  });

  // Voices
  const [voicesZh, setVoicesZh] = useState([]);
  const [voicesEn, setVoicesEn] = useState([]);
  const [voiceZhUri, setVoiceZhUri] = useState(() => localStorage.getItem('hb_voiceZh') || '');
  const [voiceEnUri, setVoiceEnUri] = useState(() => localStorage.getItem('hb_voiceEn') || '');
  const [useOpenAITts, setUseOpenAITts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hb_useOpenAITts') ?? 'false'); } catch { return false; }
  });
  const [openaiVoiceZh, _setOpenaiVoiceZh] = useState(() => localStorage.getItem('hb_openaiVoiceZh') || 'alloy');
  const [openaiVoiceEn, _setOpenaiVoiceEn] = useState(() => localStorage.getItem('hb_openaiVoiceEn') || 'alloy');
  const setOpenaiVoiceZh = (v) => { const vv = sanitizeVoice(v); _setOpenaiVoiceZh(vv); try { localStorage.setItem('hb_openaiVoiceZh', vv); } catch {} };
  const setOpenaiVoiceEn = (v) => { const vv = sanitizeVoice(v); _setOpenaiVoiceEn(vv); try { localStorage.setItem('hb_openaiVoiceEn', vv); } catch {} };
  // sanitize any old cached invalid voices on mount
  useEffect(() => { setOpenaiVoiceZh(openaiVoiceZh); setOpenaiVoiceEn(openaiVoiceEn); /* re-save sanitized */ }, []); // eslint-disable-line

  useEffect(() => { try { localStorage.setItem('hb_voiceZh', voiceZhUri); } catch {} }, [voiceZhUri]);
  useEffect(() => { try { localStorage.setItem('hb_voiceEn', voiceEnUri); } catch {} }, [voiceEnUri]);
  useEffect(() => { try { localStorage.setItem('hb_useOpenAITts', JSON.stringify(useOpenAITts)); } catch {} }, [useOpenAITts]);

  // Difficulty & policy
  const [difficulty, setDifficulty] = useState(() => {
    const v = Number(localStorage.getItem('hb_difficulty') ?? '35');
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 35;
  });
  useEffect(() => { try { localStorage.setItem('hb_difficulty', String(difficulty)); } catch {} }, [difficulty]);

  const vocabPolicy = useMemo(() => {
    const d = difficulty;
    if (d <= 10) return 'STRICT MODE: Use ONLY the listed vocabulary and their obvious forms (particles like 吗/呢/的 allowed). No new words.';
    if (d <= 35) return 'PREFER LISTED VOCAB: Strongly prefer the listed vocabulary; any new word must be extremely common and simple.';
    if (d <= 70) return 'GUIDED MODE: Prefer the listed vocabulary; introduce at most ONE new very simple A1 word per reply.';
    return 'LOOSE MODE: Use listed vocabulary when possible; you may introduce up to TWO new simple words if it improves naturalness.';
  }, [difficulty]);

  // Topic
  const [topic, setTopic] = useState(() => localStorage.getItem('hb_topic') || 'auto');
  useEffect(() => { try { localStorage.setItem('hb_topic', topic); } catch {} }, [topic]);

  // STT engine
  const hasSR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const [sttEngine, _setSttEngine] = useState(() => localStorage.getItem('hb_sttEngine') || 'auto');
  const engineResolved = sttEngine === 'auto' ? (hasSR ? 'browser' : 'whisper') : sttEngine;

  // STT states
  const [recognizing, setRecognizing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  // Reply render
  const [last, setLast] = useState({ hanzi: '', pinyin: '', english: '', usedVocab: [] });
  const [typed, setTyped] = useState('');
  const [pinyinTokens, setPinyinTokens] = useState([]);
  const [pinyinIdx, setPinyinIdx] = useState(-1);

  // Mic selection
  const [selectedMicId, setSelectedMicId] = useState(() => localStorage.getItem('hb_micId') || '');
  useEffect(() => { try { localStorage.setItem('hb_micId', selectedMicId); } catch {} }, [selectedMicId]);
  const [_micDevices, setMicDevices] = useState([]);
  useEffect(() => {
    let mounted = true;
    const enumerate = async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        tmp?.getTracks?.().forEach(t => t.stop());
        const devs = await navigator.mediaDevices.enumerateDevices();
        const mics = devs.filter((d) => d.kind === 'audioinput');
        if (!mounted) return;
        setMicDevices(mics);
        if (!selectedMicId && mics[0]) setSelectedMicId(mics[0].deviceId);
      } catch { if (mounted) setMicDevices([]); }
    };
    if (navigator.mediaDevices?.enumerateDevices) {
      enumerate();
      navigator.mediaDevices.addEventListener?.('devicechange', enumerate);
      return () => { mounted = false; navigator.mediaDevices.removeEventListener?.('devicechange', enumerate); };
    }
  }, [selectedMicId, setSelectedMicId]);

  const micLevel = useMicVolume(selectedMicId, true);

  // Toasts
  const [toasts, setToasts] = useState([]);
  const pushToast = useCallback((msg, type = 'info', ttl = 2800) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((q) => [...q, { id, msg, type }]);
    setTimeout(() => setToasts((q) => q.filter((t) => t.id !== id)), ttl);
  }, []);

  // Voice list + server health
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const zh = await listVoices({ langPrefix: 'zh' });
        const en = await listVoices({ langPrefix: 'en' });
        if (!alive) return;
        setVoicesZh(zh); setVoicesEn(en);
        const uniq = new Set([...zh.map(v => v.voiceURI), ...en.map(v => v.voiceURI)]);
        setStatus((s) => ({ ...s, voices: uniq.size || 0 }));
        if (!voiceZhUri && zh[0]) setVoiceZhUri(zh[0].voiceURI);
        if (!voiceEnUri && en[0]) setVoiceEnUri(en[0].voiceURI);
      } catch {}
    })();
    return () => { alive = false; };
  }, [voiceZhUri, voiceEnUri]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/health').then(x => x.json());
        if (!alive) return;
        setStatus((s) => ({ ...s, server: r?.ok ? 'ok' : 'fail' }));
      } catch { alive && setStatus((s) => ({ ...s, server: 'fail' })); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { setStatus((s) => ({ ...s, stt: engineResolved })); }, [engineResolved]);

  // Hanzi normalization (placeholder)
  const [normalizeHanziToggle, setNormalizeHanziToggle] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hb_normHanzi') ?? 'true'); } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem('hb_normHanzi', JSON.stringify(normalizeHanziToggle)); } catch {} }, [normalizeHanziToggle]);

  const toHanzi = useCallback(async (text) => {
    const hasHanzi = /[\u4e00-\u9fff]/.test(text || '');
    if (hasHanzi) return text;
    return text;
  }, []);

  // ---- TTS helpers (prefer server if toggled or 0 local voices) ----
  const speakZhTutor = useCallback(async (hanzi, pinyin) => {
    try {
      await unlockAudio();
      const tokens = (pinyin || '').split(/\s+/).filter(Boolean);
      if (tokens.length) { setPinyinTokens(tokens); setPinyinIdx(-1); }
      const needServer = useOpenAITts || !hasWebVoices() || status.voices === 0;
      const zv = sanitizeVoice(openaiVoiceZh);
      await speakLineTTS({
        text: hanzi || pinyin || '',
        lang: 'zh-CN',
        voiceUri: voiceZhUri,
        voiceHint: /zh|中文|Xiao|Ting|Mei|Google|Microsoft/i,
        rate: speakSlow ? 0.9 : 1.0,
        tokens,
        onBoundaryTokenIndex: (i) => { if (tokens.length) setPinyinIdx(i); },
        onStart: () => setIsSpeaking(true),
        onEnd: () => { setIsSpeaking(false); if (tokens.length) setPinyinIdx(tokens.length - 1); },
        onError: (e) => { setIsSpeaking(false); console.warn('[hb-tts zh] error', e); },
        serverTts: { enabled: needServer, allowFallback: true },
        openaiVoice: zv,
        openaiModel: ttsModel,
      });
    } catch (e) {
      console.error('[hb-tts zh] failed', e);
      pushToast('Chinese TTS failed.', 'error');
    }
  }, [pushToast, useOpenAITts, status.voices, voiceZhUri, speakSlow, setIsSpeaking, openaiVoiceZh, ttsModel]);

  const speakGeneric = useCallback(async (text, lang) => {
    try {
      await unlockAudio();
      const needServer = useOpenAITts || !hasWebVoices() || status.voices === 0;
      const isZh = lang.startsWith('zh');
      const zv = sanitizeVoice(isZh ? openaiVoiceZh : openaiVoiceEn);
      await speakLineTTS({
        text, lang,
        voiceUri: isZh ? voiceZhUri : voiceEnUri,
        voiceHint: /zh|中文|Xiao|Ting|Mei|Google|Microsoft/i,
        rate: isZh ? (speakSlow ? 0.9 : 1.0) : 1.0,
        onStart: () => setIsSpeaking(true),
        onEnd: () => setIsSpeaking(false),
        onError: (e) => { setIsSpeaking(false); console.warn('[hb-tts generic] error', e); },
        serverTts: { enabled: needServer, allowFallback: true },
        openaiVoice: zv,
        openaiModel: ttsModel,
      });
    } catch (e) {
      console.error('[hb-tts generic] failed', e);
      pushToast('TTS failed.', 'error');
    }
  }, [pushToast,useOpenAITts, status.voices, voiceZhUri, voiceEnUri, speakSlow, setIsSpeaking, openaiVoiceZh, openaiVoiceEn, ttsModel]);

  // ---- Chat ----
  const callGPT = useCallback(async (userInput, { temp = 0.4, practiceFocus = null } = {}) => {
    const vocabLine = vocabulary.length > 0 ? `Vocabulary list: ${formatVocab(vocabulary)}.` : '';
    const practiceHint = practiceFocus ? `Practice focus (use these words heavily): ${formatVocab(practiceFocus)}.` : '';
    const topicLine = topic && topic !== 'auto' ? `Topic: ${topic}. Focus your questions on this topic.` : 'Topic: general daily conversation.';

    const sys = showEnglish
      ? `Reply in EXACTLY 3 lines:\nHanzi: ...\nPinyin: ...\nEnglish: ...\n${vocabPolicy}\n${topicLine}\nKeep sentences short and beginner-friendly.\n${vocabLine}\n${practiceHint}`
      : `Reply in EXACTLY 2 lines:\nHanzi: ...\nPinyin: ...\nNO English.\n${vocabPolicy}\n${topicLine}\nKeep sentences short and beginner-friendly.\n${vocabLine}\n${practiceHint}`;

    const historyNoSystem = messagesRef.current.filter((m) => m.role !== 'system');
    const newMsgs = [{ role: 'system', content: sys }, ...historyNoSystem, { role: 'user', content: `${userInput ?? ''}`.trim() }];

    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: chatModel, messages: newMsgs, temperature: 0.25 + temp * 0.75 }),
    });
    if (!r.ok) { pushToast('Chat request failed', 'error'); return; }
    const data = await r.json();
    const content = (data?.choices?.[0]?.message?.content ?? '').trim();
    let parsed = parseTutorReply(content, showEnglish);
    if (parsed.hanzi && !parsed.pinyin) {
      const pin = await ensurePinyinFromServer(parsed.hanzi, chatModel);
      if (pin) parsed.pinyin = pin;
    }
    const used = [];
    if (parsed.hanzi && vocabulary.length) {
      for (const w of vocabulary) {
        const h = (w?.hanzi ?? '').trim();
        if (h && parsed.hanzi.includes(h)) used.push(w);
      }
    }
    setLast({ ...parsed, usedVocab: used });

    addToHistory({
      ts: Date.now(),
      prompt: { hanzi: userInput ?? '' },
      response: content,
      responseUser: userResponse ?? '',
      replyParsed: parsed,
      usedVocab: used,
    });
    setMessages((prev) => [...prev, { role: 'assistant', content }]);

    await speakZhTutor(parsed.hanzi, parsed.pinyin);
    if (showEnglish && speakEnglish && parsed.english) {
      if (speakEnglishDelay > 0) await new Promise((r2) => setTimeout(r2, speakEnglishDelay));
      await speakGeneric(parsed.english, 'en-US');
    }
  }, [pushToast,showEnglish, speakEnglish, speakEnglishDelay, vocabulary, addToHistory, userResponse, speakZhTutor, speakGeneric, vocabPolicy, topic, chatModel]);

  // greet once after vocab
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (vocabulary.length === 0) return;
    if (!firstRunRef.current) return;
    firstRunRef.current = false;
    callGPT('Greet me briefly and ask a very simple question that uses the uploaded vocabulary.');
  }, [vocabulary.length, callGPT]);

  // Browser STT
  const startRecognition = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Browser STT not supported. Use Whisper mode.'); return; }
    const recognition = new SR();
    recognition.lang = 'zh-CN'; recognition.interimResults = false; recognition.maxAlternatives = 1;
    recognition.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? '';
      setUserResponse(transcript);
      callGPT(transcript, { temp: 0.4 });
    };
    recognition.onend = () => setRecognizing(false);
    recognition.onerror = () => setRecognizing(false);
    setRecognizing(true); recognition.start();
  }, [callGPT, setUserResponse]);

  // Whisper STT (hold)
  const mediaRecRef = useRef(null);
  const recChunksRef = useRef([]);
  const recTimerRef = useRef(null);
  const recCountRef = useRef(0);

  const startWhisperRecording = useCallback(async () => {
    try {
      const constraints = selectedMicId ? { audio: { deviceId: { exact: selectedMicId } } } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const mr = new MediaRecorder(stream);
      recChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e?.data?.size) recChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        const blob = new Blob(recChunksRef.current, { type: 'audio/webm' });
        if (blob.size < 1024) { setRecording(false); return; }
        try {
          const raw = await transcribeBlobToText(blob, { language: 'zh', model: sttModel });
          const text = normalizeHanziToggle ? await toHanzi(raw || '') : (raw || '');
          if (text) { setUserResponse(text); await callGPT(text, { temp: 0.4 }); }
          else { pushToast('No speech detected.', 'warn'); }
        } catch { pushToast('Whisper STT failed', 'error'); }
        finally { setRecording(false); }
      };
      mediaRecRef.current = mr;
      mr.start();
      setRecording(true);
      setRecSeconds(0);
      recCountRef.current = 0;
      if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
      recTimerRef.current = setInterval(() => {
        recCountRef.current += 1;
        setRecSeconds(recCountRef.current);
        if (recCountRef.current >= 10) {
          try { mediaRecRef.current?.stop(); } catch {}
          if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
        }
      }, 1000);
    } catch { pushToast('Microphone access failed.', 'error'); }
  }, [normalizeHanziToggle, selectedMicId, toHanzi, callGPT, sttModel, setUserResponse, pushToast]);

  const stopWhisperRecording = useCallback(() => {
    try { if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') mediaRecRef.current.stop(); } catch {}
    mediaRecRef.current = null;
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
  }, []);

  // Mic test (2s) — restores the missing button
  const testingRef = useRef(false);
  const testMic2s = useCallback(async () => {
    if (testingRef.current) return;
    testingRef.current = true;
    try {
      const constraints = selectedMicId ? { audio: { deviceId: { exact: selectedMicId } } } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e?.data?.size) chunks.push(e.data); };
      mr.onstop = async () => {
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (blob.size < 512) { pushToast('Mic test: no audio captured', 'warn'); testingRef.current = false; return; }
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        a.onended = () => { try { URL.revokeObjectURL(url); } catch {}; testingRef.current = false; };
        await a.play().catch(() => { testingRef.current = false; });
      };
      mr.start();
      pushToast('Mic test: recording 2s…', 'info');
      setTimeout(() => { try { mr.stop(); } catch {} }, 2000);
    } catch {
      testingRef.current = false;
      pushToast('Mic test failed (permission/availability).', 'error');
    }
  }, [selectedMicId, pushToast]);

  // Type-to-talk
  const onSendTyped = useCallback(async () => {
    const text = (typed || '').trim();
    if (!text) return;
    setUserResponse(text);
    setTyped('');
    await callGPT(text, { temp: 0.4 });
  }, [typed, setUserResponse, callGPT]);

  // Audio unlock + diagnostics
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const runAudioDiagnostics = useCallback(async () => {
   /* const log = (...a) => console.log('[diag]', ...a);*/
    log('Starting diagnostics…');
    const ctx = (() => { try { return new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } })();
    if (!ctx) { pushToast('No AudioContext', 'error'); return; }
    try { await ctx.resume(); } catch {}
    log('AudioContext', { state: ctx.state, sampleRate: ctx.sampleRate });

    const voices = await listVoices().catch(() => []);
    log('Voices', voices.length);

    try {
      const r = await fetch('/api/health').then(x => x.json());
      log('/api/health', r);
    } catch (e) { log('/api/health failed', e); }

    try {
      const r = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'check', voice: sanitizeVoice(openaiVoiceEn) || 'alloy', model: ttsModel, lang: 'en-US' })
      });
      log('/api/tts status', r.status, r.headers.get('content-type'));
      const buf = await r.arrayBuffer();
      log('/api/tts bytes', buf.byteLength);
      if (buf.byteLength === 0) pushToast('TTS returned 0 bytes', 'error');
      else pushToast('TTS endpoint OK', 'info');
    } catch (e) {
      log('/api/tts error', e);
      pushToast('TTS request failed. See console.', 'error');
    } finally { try { ctx.close(); } catch {} }
  }, [openaiVoiceEn, ttsModel, pushToast]);

  const enableAudio = useCallback(async () => {
    const ok = await unlockAudio();
    setAudioUnlocked(ok);
    if (ok) {
      await beep(880, 80);
      await new Promise(r => setTimeout(r, 80));
      await beep(1320, 80);
      pushToast('Audio ready.', 'info');
      setTimeout(() => { runAudioDiagnostics(); }, 100);
    } else {
      pushToast('Audio unlock failed. Click any sound button.', 'warn');
    }
  }, [runAudioDiagnostics, pushToast]);

  // Tests (prefer server when OpenAI TTS ON or voices===0)
  const testZh = useCallback(() => speakZhTutor('你好，我叫华语伙伴。', 'nǐ hǎo, wǒ jiào huáyǔ huǒbàn'), [speakZhTutor]);
  const testEn = useCallback(() => speakGeneric('Hello! This is an English test.', 'en-US'), [speakGeneric]);

  // UI
  return (
    <div className="p-4 bg-white rounded shadow relative">
      <h2 className="text-lg font-bold mb-2">🧠 Conversation</h2>

      {/* Status */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Pill label={`Local voices: ${status.voices}`} state={status.voices > 0 ? 'ok' : 'warn'} />
        <Pill label={`Server TTS: ${status.server === 'ok' ? 'OK' : status.server === 'fail' ? 'Fail' : '…'}`}
              state={status.server === 'ok' ? 'ok' : status.server === 'fail' ? 'fail' : 'warn'} />
        <Pill label={`STT: ${engineResolved === 'browser' ? 'Browser' : 'Whisper'}`} state="ok" />
        <Pill label={`Browser STT: ${engineResolved==='browser' ? (recognizing ? 'Listening…' : 'Idle') : 'n/a'}`}
              state={engineResolved==='browser' ? (recognizing ? 'ok' : 'warn') : 'warn'} />
        <Pill label={`Whisper: ${engineResolved==='whisper' ? (recording ? `Rec ${recSeconds}s` : 'Idle') : 'n/a'}`}
              state={engineResolved==='whisper' ? (recording ? 'ok' : 'warn') : 'warn'} />
      </div>

      {/* Model pickers */}
      <div className="mb-3 p-3 rounded border bg-gray-50">
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex items-center gap-2">
            <span className="text-sm text-gray-700 w-28">Chat model</span>
            <select className="px-2 py-1 border rounded" value={chatModel} onChange={(e) => setChatModel(e.target.value)}>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4o">gpt-4o</option>
            </select>
            <span className="text-xs text-gray-500">default: {config.chatModel}</span>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-sm text-gray-700 w-28">STT model</span>
            <select className="px-2 py-1 border rounded" value={sttModel} onChange={(e) => setSttModel(e.target.value)}>
              <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe</option>
              <option value="gpt-4o-transcribe">gpt-4o-transcribe</option>
            </select>
            <span className="text-xs text-gray-500">default: {config.sttModel}</span>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-sm text-gray-700 w-28">TTS model</span>
            <select className="px-2 py-1 border rounded" value={ttsModel} onChange={(e) => setTtsModel(e.target.value)}>
              <option value="tts-1">tts-1</option>
              <option value="tts-1-hd">tts-1-hd</option>
              <option value="gpt-4o-mini-tts">gpt-4o-mini-tts</option>
            </select>
            <span className="text-xs text-gray-500">default: {config.ttsModel}</span>
          </label>
        </div>
      </div>

      {/* Voice pickers */}
      <div className="mb-3 p-3 rounded border bg-gray-50">
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex items-center gap-2">
            <span className="text-sm text-gray-700 w-28">Chinese voice</span>
            <select className="px-2 py-1 border rounded min-w-[220px]" value={voiceZhUri} onChange={(e) => setVoiceZhUri(e.target.value)} disabled={useOpenAITts}>
              {voicesZh.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} {v.default ? '· default' : ''} — {v.lang}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-sm text-gray-700 w-28">English voice</span>
            <select className="px-2 py-1 border rounded min-w-[220px]" value={voiceEnUri} onChange={(e) => setVoiceEnUri(e.target.value)} disabled={useOpenAITts}>
              {voicesEn.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} {v.default ? '· default' : ''} — {v.lang}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useOpenAITts} onChange={() => setUseOpenAITts((v) => !v)} />
            <span className="text-sm text-gray-700">Use OpenAI TTS</span>
          </label>
          {useOpenAITts && (
            <>
              <label className="flex items-center gap-2">
                <span className="text-sm text-gray-700">OpenAI zh voice</span>
                <select className="px-2 py-1 border rounded" value={openaiVoiceZh} onChange={(e) => setOpenaiVoiceZh(e.target.value)}>
                  {OPENAI_ALLOWED_VOICES.map(v => <option key={`zh-${v}`} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-sm text-gray-700">OpenAI en voice</span>
                <select className="px-2 py-1 border rounded" value={openaiVoiceEn} onChange={(e) => setOpenaiVoiceEn(e.target.value)}>
                  {OPENAI_ALLOWED_VOICES.map(v => <option key={`en-${v}`} value={v}>{v}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        <p className="text-xs text-gray-600 mt-2">Server supports: {OPENAI_ALLOWED_VOICES.join(', ')}.</p>
      </div>

      {/* Controls — SINGLE BLOCK */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <button onClick={enableAudio}
                className={`px-3 py-2 rounded ${audioUnlocked ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-white'}`}>
          {audioUnlocked ? '🔊 Audio ready' : '🔊 Enable audio'}
        </button>
        <button onClick={runAudioDiagnostics} className="px-3 py-2 bg-zinc-700 text-white rounded">🛠 Diagnostics</button>
        <button onClick={testMic2s} className="px-3 py-2 bg-slate-600 text-white rounded">🎧 Test mic (2s)</button>
        <button onClick={() => setDrawerOpen(true)} className="px-3 py-2 bg-slate-700 text-white rounded">⚙️ Presets</button>

        {/* STT: Browser */}
        <button onClick={startRecognition}
                disabled={engineResolved !== 'browser'}
                className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-50">
          {engineResolved !== 'browser' ? '🎤 Speak (Browser: N/A)' : (recognizing ? '🎙 Listening…' : '🎤 Speak (Browser)')}
        </button>

        {/* STT: Whisper (hold) */}
        <button
          onMouseDown={() => engineResolved === 'whisper' && startWhisperRecording()}
          onMouseUp={() => engineResolved === 'whisper' && stopWhisperRecording()}
          onMouseLeave={() => engineResolved === 'whisper' && stopWhisperRecording()}
          onTouchStart={(e) => { e.preventDefault(); engineResolved === 'whisper' && startWhisperRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); engineResolved === 'whisper' && stopWhisperRecording(); }}
          disabled={engineResolved !== 'whisper'}
          className={`px-4 py-2 rounded text-white ${recording ? 'bg-red-600' : 'bg-rose-700'} disabled:opacity-50`}
          title="Hold to record; release to transcribe"
        >
          {engineResolved !== 'whisper'
            ? '🎙 Hold (Whisper: N/A)'
            : (recording ? `● Recording… ${recSeconds}s` : '🎙 Hold to talk (Whisper)')}
        </button>

        {/* Practice, Test, Replay */}
        <button onClick={() => {
          if (!vocabulary.length) return alert('Upload a vocabulary PDF first.');
          const focus = [...vocabulary].sort(() => 0.5 - Math.random()).slice(0, 6);
          callGPT('Please start a short 3-round practice using BEGINNER vocabulary. Ask ONE short question now using the focus words. Wait for my answer.', { temp: 0.45, practiceFocus: focus });
        }} disabled={!vocabulary.length}
        className="px-3 py-2 bg-emerald-600 text-white rounded disabled:opacity-50">
          🧪 Practice from vocab
        </button>

        <button onClick={testZh} className="px-3 py-2 bg-blue-600 text-white rounded">🔊 Test zh</button>
        <button onClick={testEn} className="px-3 py-2 bg-indigo-600 text-white rounded">🔊 Test en</button>

        <button
          onClick={async () => {
            if (last?.hanzi) await speakZhTutor(last.hanzi, last.pinyin);
            if (showEnglish && last?.english) await speakGeneric(last.english, 'en-US');
          }}
          disabled={!last?.hanzi && !(showEnglish && last?.english)}
          className="px-3 py-2 bg-amber-600 text-white rounded disabled:opacity-50"
        >
          🔁 Replay last
        </button>
      </div>

      <RealtimePanel />

      {/* Difficulty + toggles */}
      <div className="mt-3 p-3 rounded border bg-gray-50">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-700 w-24">Difficulty</span>
          <input type="range" min={0} max={100} step={5} value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))} className="flex-1" />
          <span className="text-xs text-gray-600 w-24 text-right">
            {difficulty <= 10 ? 'Strict' : difficulty <= 35 ? 'Tight' : difficulty <= 70 ? 'Balanced' : 'Loose'}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={showEnglish} onChange={() => setShowEnglish((v) => !v)} />🈶 Show English</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={speakSlow} onChange={() => setSpeakSlow((v) => !v)} />🐢 Speak slowly</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={speakEnglish} onChange={() => setSpeakEnglish((v) => !v)} />🗣️ Speak English</label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">EN delay</span>
            <input type="range" min={0} max={2000} step={100} value={speakEnglishDelay} onChange={(e) => setSpeakEnglishDelay(Number(e.target.value))} />
            <span className="text-xs text-gray-600 w-10 text-right">{Math.round(speakEnglishDelay / 1000)}s</span>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={normalizeHanziToggle} onChange={() => setNormalizeHanziToggle((v) => !v)} /><span className="text-sm text-gray-700">Normalize mic → Hanzi</span></label>
        </div>
      </div>

      {/* meters */}
      <div className="mb-3 mt-3 flex flex-wrap gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">Mic</span>
          <div className="w-40 h-2 bg-gray-200 rounded overflow-hidden">
            <div className="h-2" style={{ background: 'linear-gradient(90deg, #16a34a, #22c55e)', width: `${Math.round(micLevel * 100)}%` }} />
          </div>
          <span className="text-xs text-gray-600 w-10 text-right">{Math.round(micLevel * 100)}%</span>
        </div>
        <TtsVu />
      </div>

      {/* Type-to-talk */}
      <div className="mb-3 flex gap-2">
        <textarea
          className="flex-1 border rounded p-2 text-sm"
          placeholder="Type in English or Chinese… (Enter = send, Shift+Enter = newline)"
          rows={2}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendTyped(); } }}
        />
        <div className="flex flex-col gap-2">
          <button onClick={onSendTyped} disabled={!typed.trim()} className="px-3 py-2 bg-emerald-600 text-white rounded disabled:opacity-50">↩ Send</button>
          <button onClick={() => setTyped('')} disabled={!typed} className="px-3 py-2 bg-gray-200 rounded disabled:opacity-50">Clear</button>
        </div>
      </div>

      {(last.hanzi || last.pinyin || last.english) && (
        <div className="mb-3">
          {last.hanzi && <p className="text-xl font-semibold">{last.hanzi}</p>}
          {last.pinyin && pinyinTokens.length > 0 ? (
            <p className="text-md text-gray-800 leading-7">
              {pinyinTokens.map((tk, i) => (
                <span key={`${tk}-${i}`}
                      className={i < pinyinIdx ? 'bg-yellow-100 px-0.5 rounded'
                        : i === pinyinIdx ? 'bg-yellow-300 px-0.5 rounded font-semibold'
                        : 'px-0.5'}>
                  {tk}{i < pinyinTokens.length - 1 ? ' ' : ''}
                </span>
              ))}
            </p>
          ) : (last.pinyin && <p className="text-md text-gray-700">{last.pinyin}</p>)}
          {showEnglish && last.english && <p className="text-md text-blue-700 italic">{last.english}</p>}
        </div>
      )}

      {userResponse && <p className="text-sm text-gray-700">✅ You said: <span className="font-medium">{userResponse}</span></p>}

      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        values={{
          chatModel, sttModel, ttsModel,
          voiceZhUri, voiceEnUri, useOpenAITts, openaiVoiceZh, openaiVoiceEn,
          selectedMicId,
          showEnglish, speakSlow, speakEnglish, speakEnglishDelay,
          difficulty, topic,
        }}
        apply={(p) => {
          if (p.chatModel) setChatModel(p.chatModel);
          if (p.sttModel) setSttModel(p.sttModel);
          if (p.ttsModel) setTtsModel(p.ttsModel);
          if (typeof p.useOpenAITts === 'boolean') setUseOpenAITts(p.useOpenAITts);
          if (p.voiceZhUri) setVoiceZhUri(p.voiceZhUri);
          if (p.voiceEnUri) setVoiceEnUri(p.voiceEnUri);
          if (p.openaiVoiceZh) setOpenaiVoiceZh(p.openaiVoiceZh);
          if (p.openaiVoiceEn) setOpenaiVoiceEn(p.openaiVoiceEn);
          if (p.selectedMicId) setSelectedMicId(p.selectedMicId);
          if (typeof p.showEnglish === 'boolean') setShowEnglish(p.showEnglish);
          if (typeof p.speakSlow === 'boolean') setSpeakSlow(p.speakSlow);
          if (typeof p.speakEnglish === 'boolean') setSpeakEnglish(p.speakEnglish);
          if (typeof p.speakEnglishDelay === 'number') setSpeakEnglishDelay(p.speakEnglishDelay);
          if (typeof p.difficulty === 'number') setDifficulty(p.difficulty);
          if (p.topic) setTopic(p.topic);
        }}
      />
      <Toasts toasts={toasts} />
    </div>
  );
}
