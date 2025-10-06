// File: src/components/Review.jsx
import React, { useState, useMemo } from 'react';
import { useConversationStore } from '../store/useConversationStore';
import { speakLine } from '../utils/tts';

// Quick token-overlap score for self-review.
function estimateScore(pinyin, userText) {
  const p = (pinyin ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const u = (userText ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!p.length || !u.length) return 0;
  const pSet = new Set(p);
  const matches = u.filter(w => pSet.has(w)).length;
  return Math.round((matches / p.length) * 100);
}

function csvEscape(s) {
  return `"${String(s ?? '').replace(/"/g, '""')}"`;
}

function normalizeTs(tsLike) {
  if (!tsLike && tsLike !== 0) return null;
  if (typeof tsLike === 'number') {
    const d = new Date(tsLike);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof tsLike === 'string') {
    const t = Date.parse(tsLike);
    if (Number.isFinite(t)) return new Date(t);
    // fallback for ISO-ish without timezone
    const d = new Date(tsLike.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (tsLike instanceof Date) return tsLike;
  return null;
}

function fmtTs(d) {
  try {
    return d?.toLocaleString?.() ?? '—';
  } catch {
    return '—';
  }
}

export default function Review() {
  const { responseHistory, clearHistory, setIsSpeaking } = useConversationStore();
  const [filter, setFilter] = useState('');

  // Stable hooks first; no early return yet.
  const history = Array.isArray(responseHistory) ? responseHistory : [];

  const rows = useMemo(() => {
    return history.map((entry) => {
      const hanzi   = entry?.replyParsed?.hanzi   ?? entry?.prompt?.hanzi   ?? '';
      const pinyin  = entry?.replyParsed?.pinyin  ?? entry?.prompt?.pinyin  ?? '';
      const english = entry?.replyParsed?.english ?? '';
      const user    = entry?.responseUser ?? entry?.response ?? '';
      // Try common timestamp field names; future-proof
      const tsRaw = entry?.ts ?? entry?.timestamp ?? entry?.createdAt ?? entry?.date ?? entry?.at ?? null;
      const ts = normalizeTs(tsRaw);
      return { hanzi, pinyin, english, user, ts };
    });
  }, [history]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.hanzi.includes(filter) ||
      r.pinyin.toLowerCase().includes(q) ||
      r.english.toLowerCase().includes(q) ||
      r.user.toLowerCase().includes(q) ||
      (r.ts && fmtTs(r.ts).toLowerCase().includes(q))
    );
  }, [rows, filter]);

  const onExportCSV = () => {
    const header = ['Timestamp', 'Hanzi', 'Pinyin', 'English', 'User', 'Score'];
    const lines = [
      header.map(csvEscape).join(','),
      ...filtered.map(r => {
        const score = estimateScore(r.pinyin, r.user);
        const stamp = r.ts ? fmtTs(r.ts) : '—';
        return [stamp, r.hanzi, r.pinyin, r.english, r.user, `${score}`]
          .map(csvEscape)
          .join(',');
      }),
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `huayu-buddy-review-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const replayZh = async (hanzi) => {
    if (!hanzi?.trim()) return;
    await speakLine({
      text: hanzi,
      lang: 'zh-CN',
      serverTts: { enabled: true, allowFallback: true },
      onStart: () => setIsSpeaking?.(true),
      onEnd:   () => setIsSpeaking?.(false),
      onError: () => setIsSpeaking?.(false),
    });
  };

  const replayEn = async (english) => {
    if (!english?.trim()) return;
    await speakLine({
      text: english,
      lang: 'en-US',
      serverTts: { enabled: true, allowFallback: true },
      onStart: () => setIsSpeaking?.(true),
      onEnd:   () => setIsSpeaking?.(false),
      onError: () => setIsSpeaking?.(false),
    });
  };

  if (filtered.length === 0) return null; // hooks already ran above

  return (
    <div className="mt-10 p-4 bg-white rounded-xl shadow">
      <h2 className="text-xl font-bold mb-4">📚 Review All Responses</h2>

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          placeholder="Filter by time / Hanzi / Pinyin / English / User..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 p-2 border rounded"
        />
        <button
          onClick={onExportCSV}
          className="px-4 py-2 bg-sky-600 text-white rounded shadow hover:bg-sky-700"
          title="Download CSV (Timestamp, Hanzi, Pinyin, English, User, Score)"
        >
          ⤓ Export CSV
        </button>
        <button
          onClick={clearHistory}
          className="px-4 py-2 bg-red-600 text-white rounded shadow hover:bg-red-700"
          title="Clear all logged turns"
        >
          🗑 Clear
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="table-auto w-full text-sm text-left">
          <thead>
            <tr>
              <th className="px-2 py-1 border-b">#</th>
              <th className="px-2 py-1 border-b">Timestamp</th>
              <th className="px-2 py-1 border-b">Tutor (Hanzi)</th>
              <th className="px-2 py-1 border-b">Pinyin</th>
              <th className="px-2 py-1 border-b">English</th>
              <th className="px-2 py-1 border-b">User Response</th>
              <th className="px-2 py-1 border-b">Score</th>
              <th className="px-2 py-1 border-b">Play</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => (
              <tr key={idx} className="border-t align-top">
                <td className="px-2 py-2">{idx + 1}</td>
                <td className="px-2 py-2 whitespace-nowrap">{r.ts ? fmtTs(r.ts) : '—'}</td>
                <td className="px-2 py-2 whitespace-pre-wrap">{r.hanzi}</td>
                <td className="px-2 py-2 whitespace-pre-wrap">{r.pinyin}</td>
                <td className="px-2 py-2 whitespace-pre-wrap text-blue-700 italic">{r.english}</td>
                <td className="px-2 py-2 whitespace-pre-wrap">{r.user}</td>
                <td className="px-2 py-2">{estimateScore(r.pinyin, r.user)}%</td>
                <td className="px-2 py-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => replayZh(r.hanzi)}
                      className="px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
                      title="Replay tutor's Hanzi (ZH)"
                    >
                      🔊 Replay (ZH)
                    </button>
                    <button
                      onClick={() => replayEn(r.english)}
                      disabled={!r.english?.trim()}
                      className="px-2 py-1 text-xs bg-indigo-600 text-white rounded disabled:opacity-50 hover:bg-indigo-700"
                      title="Replay English"
                    >
                      🔊 Replay (EN)
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
