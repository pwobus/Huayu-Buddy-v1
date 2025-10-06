// File: src/components/HealhCard.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { listVoices, unlockAudio } from '../utils/tts';

function Pill({ ok, label }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${
      ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
    }`}>{label}</span>
  );
}

export default function HealthCard() {
  const [apiOk, setApiOk] = useState(null);
  const [ttsOk, setTtsOk] = useState(null);
  const [glbOk, setGlbOk] = useState(null);
  const [voices, setVoices] = useState(0);

  const runChecks = useCallback(async () => {
    try {
      setApiOk(null); setTtsOk(null); setGlbOk(null); setVoices(0);

      // API proxy
      const h = await fetch('/api/health').then(r => r.ok ? r.json() : null).catch(() => null);
      setApiOk(!!h);

      // Voices
      const v = await listVoices().catch(() => []);
      setVoices(v.length || 0);

      // GLB presence (use Range to avoid full file)
      const g = await fetch('/head-avatar.glb', { headers: { Range: 'bytes=0-0' } }).catch(() => null);
      setGlbOk(!!(g && (g.ok || g.status === 206)));

      // TTS endpoint bytes > 0
      await unlockAudio();
      const r = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'check', voice: 'alloy', model: 'tts-1', lang: 'en-US' })
      });
      if (!r.ok) { setTtsOk(false); return; }
      const ab = await r.arrayBuffer();
      setTtsOk(ab.byteLength > 0);
    } catch {
      setTtsOk(false);
    }
  }, []);

  useEffect(() => { runChecks(); }, [runChecks]);

  return (
    <div className="p-3 mb-4 bg-white rounded shadow">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">System health</h3>
        <button onClick={runChecks} className="px-2 py-1 text-xs bg-gray-800 text-white rounded">Run checks</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        <Pill ok={apiOk === true}  label={`API ${apiOk ? 'OK' : 'Fail'}`} />
        <Pill ok={ttsOk === true}  label={`/api/tts ${ttsOk ? 'OK' : 'Fail'}`} />
        <Pill ok={glbOk === true}  label={`GLB ${glbOk ? 'OK' : 'Fail'}`} />
        <Pill ok={voices > 0}      label={`Voices ${voices}`} />
      </div>
      <div className="mt-2">
        <button
          onClick={() => { const a = new Audio('/api/tone'); a.play().catch(()=>{}); }}
          className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
        >
          ▶ Tone (server)
        </button>
      </div>
    </div>
  );
}
