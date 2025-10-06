// File: src/components/SettingsDrawer.jsx
import React, { useEffect, useMemo, useState } from 'react';

function usePresets() {
  const read = () => {
    try { return JSON.parse(localStorage.getItem('hb_presets') ?? '{}'); } catch { return {}; }
  };
  const write = (obj) => {
    try { localStorage.setItem('hb_presets', JSON.stringify(obj)); } catch {}
  };
  const [presets, setPresets] = useState(read);
  const refresh = () => setPresets(read());
  const save = (name, data) => { const m = read(); m[name] = data; write(m); refresh(); };
  const remove = (name) => { const m = read(); delete m[name]; write(m); refresh(); };
  return { presets, save, remove, refresh };
}

export default function SettingsDrawer({
  open, onClose,
  // current values
  values,
  // setters to apply a preset
  apply,
}) {
  const { presets, save, remove, refresh } = usePresets();
  const [name, setName] = useState('');
  const list = useMemo(() => Object.entries(presets).map(([k, v]) => ({ name: k, data: v })), [presets]);

  useEffect(() => { if (!open) setName(''); }, [open]);

  const onSave = () => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    save(trimmed, values);
  };
  const onExport = () => {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'huayu-buddy-presets.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const onImport = async (file) => {
    try {
      const txt = await file.text();
      const obj = JSON.parse(txt);
      localStorage.setItem('hb_presets', JSON.stringify(obj));
      refresh();
    } catch {}
  };

  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}>
      {/* backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      {/* drawer */}
      <div className={`absolute right-0 top-0 h-full w-[380px] bg-white shadow-xl transform transition-transform
        ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold">⚙️ Presets</h3>
          <button onClick={onClose} className="text-gray-600 hover:text-black">✕</button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <div className="space-y-2">
            <div className="font-medium text-gray-700">Save current settings</div>
            <input
              className="w-full border rounded px-2 py-1"
              placeholder="Preset name, e.g., Ubuntu-Desk"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              onClick={onSave}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded disabled:opacity-50"
              disabled={!name.trim()}
            >
              💾 Save preset
            </button>
          </div>

          <div className="space-y-2">
            <div className="font-medium text-gray-700">Import / Export</div>
            <div className="flex gap-2">
              <button onClick={onExport} className="px-3 py-1.5 bg-sky-600 text-white rounded">⤓ Export</button>
              <label className="px-3 py-1.5 bg-gray-200 rounded cursor-pointer">
                ⤒ Import
                <input type="file" accept="application/json" className="hidden"
                       onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-medium text-gray-700">Saved presets</div>
            {list.length === 0 && <div className="text-gray-500">No presets yet.</div>}
            <div className="divide-y border rounded">
              {list.map(({ name, data }) => (
                <div key={name} className="p-2 flex items-center justify-between">
                  <div className="text-gray-800">{name}</div>
                  <div className="flex gap-2">
                    <button onClick={() => apply(data)} className="px-2 py-1 text-xs bg-indigo-600 text-white rounded">Apply</button>
                    <button onClick={() => remove(name)} className="px-2 py-1 text-xs bg-red-600 text-white rounded">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Included settings: chat/STT/TTS models, voice choices (local or OpenAI), OpenAI voice names, selected mic, English/pacing toggles, difficulty, topic.
          </div>
        </div>
      </div>
    </div>
  );
}
