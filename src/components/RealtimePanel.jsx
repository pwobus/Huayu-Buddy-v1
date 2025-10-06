// src/components/RealtimePanel.jsx
import React, { useEffect, useRef, useState } from 'react';

/**
 * Minimal WebRTC panel for OpenAI Realtime (Preview).
 * - Connect: obtains ephemeral token from /api/realtime-session
 * - Starts mic capture, sets up RTCPeerConnection
 * - Sends SDP offer to OpenAI, sets answer, plays remote audio
 * - Push-to-talk: toggles mic track enabled
 *
 * Notes:
 * - Requires server route /api/realtime-session.
 * - Uses OpenAI Realtime WebRTC with "OpenAI-Beta: realtime=v1" header on SDP exchange.
 */
export default function RealtimePanel() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [ptt, setPtt] = useState(false);
  const [voice, setVoice] = useState(() => localStorage.getItem('hb_rt_voice') || 'alloy');
  const [model, setModel] = useState(() => localStorage.getItem('hb_rt_model') || 'gpt-4o-mini-realtime-preview');

  const pcRef = useRef(null);
  const micStreamRef = useRef(null);
  const micTrackRef = useRef(null);
  const remoteAudioRef = useRef(null);

  useEffect(() => { try { localStorage.setItem('hb_rt_voice', voice); } catch {} }, [voice]);
  useEffect(() => { try { localStorage.setItem('hb_rt_model', model); } catch {} }, [model]);

  useEffect(() => {
    remoteAudioRef.current = new Audio();
    remoteAudioRef.current.autoplay = true;
  }, []);

  const disconnect = async () => {
    setConnecting(false);
    setConnected(false);
    setPtt(false);
    try { micTrackRef.current && (micTrackRef.current.enabled = false); } catch {}
    try { pcRef.current?.getSenders?.().forEach((s) => s.track && s.track.stop()); } catch {}
    try { micStreamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
    try { pcRef.current?.close?.(); } catch {}
    pcRef.current = null;
    micStreamRef.current = null;
    micTrackRef.current = null;
  };

  const connect = async () => {
    if (connected || connecting) return;
    setConnecting(true);

    try {
      // 1) Ask our server for ephemeral token (and voice/model we want)
      const tokenResp = await fetch('/api/realtime-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, voice }),
      });
      if (!tokenResp.ok) throw new Error('Failed to create realtime session');
      const data = await tokenResp.json();
      const EPHEMERAL = data?.client_secret?.value;
      if (!EPHEMERAL) throw new Error('No ephemeral token');

      // 2) WebRTC peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // remote audio sink
      pc.ontrack = (e) => {
        if (e?.streams?.[0] && remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
        }
      };

      // optional: data channel if you want realtime events/text (not used here)
      // const dc = pc.createDataChannel('oai-events');

      // 3) Add local mic
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = ms;
      const [track] = ms.getAudioTracks();
      micTrackRef.current = track;
      pc.addTrack(track, ms);

      // 4) Prepare offer and send SDP to OpenAI Realtime endpoint
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const url = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
      const sdpResp = await fetch(url, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL}`,
          'Content-Type': 'application/sdp',
          'OpenAI-Beta': 'realtime=v1',
        },
      });
      if (!sdpResp.ok) throw new Error(`SDP exchange failed: ${sdpResp.status}`);
      const answer = await sdpResp.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });

      setConnected(true);
      setPtt(true);
      if (micTrackRef.current) micTrackRef.current.enabled = true;
    } catch (e) {
      console.error('[realtime connect]', e);
      await disconnect();
      alert(`Realtime connect failed: ${e?.message || e}`);
    } finally {
      setConnecting(false);
    }
  };

  const togglePTT = () => {
    const track = micTrackRef.current;
    if (!track) return;
    const next = !ptt;
    setPtt(next);
    track.enabled = next; // enable/disable mic flow to model
  };

  return (
    <div className="p-3 rounded border bg-gray-50">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Realtime (beta)</span>
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-700">Model</span>
          <select className="px-2 py-1 border rounded"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={connected || connecting}>
            <option value="gpt-4o-mini-realtime-preview">gpt-4o-mini-realtime-preview</option>
            <option value="gpt-4o-realtime-preview">gpt-4o-realtime-preview</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-700">Voice</span>
          <select className="px-2 py-1 border rounded"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  disabled={connected || connecting}>
            <option value="alloy">alloy</option>
            <option value="sage">sage</option>
            <option value="aria">aria</option>
            <option value="verse">verse</option>
          </select>
        </label>

        {!connected ? (
          <button
            disabled={connecting}
            onClick={connect}
            className="px-3 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        ) : (
          <>
            <button
              onClick={togglePTT}
              className={`px-3 py-2 rounded text-white ${ptt ? 'bg-red-600' : 'bg-slate-600'}`}
              title="Push-to-talk toggles mic track to the model"
            >
              {ptt ? '● Mic LIVE' : 'Mic muted'}
            </button>
            <button
              onClick={disconnect}
              className="px-3 py-2 bg-gray-300 rounded"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-gray-600 mt-2">
        Uses OpenAI Realtime API over WebRTC with ephemeral token. Push-to-talk lets you gate the mic track.
      </p>
    </div>
  );
}
