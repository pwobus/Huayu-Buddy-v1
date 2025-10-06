// File: src/hooks/useMicVolume.js
import { useEffect, useRef, useState } from 'react';

/** Returns smoothed mic level 0..1 for given deviceId when enabled=true. */
export default function useMicVolume(deviceId, enabled) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef(0);
  const ctxRef = useRef(null);
  const srcRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const emaRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      setLevel(0);
      emaRef.current = 0;
      try { srcRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect(); } catch {}
      try { ctxRef.current?.close(); } catch {}
      try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
      ctxRef.current = srcRef.current = analyserRef.current = streamRef.current = null;
      return;
    }

    let cancelled = false;
    const AC = window.AudioContext || window.webkitAudioContext;

    (async () => {
      try {
        const constraints = deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        const ctx = new AC();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);

        ctxRef.current = ctx;
        srcRef.current = src;
        analyserRef.current = analyser;
        streamRef.current = stream;

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) {
            const a = Math.abs(data[i] - 128) / 128;
            if (a > peak) peak = a;
          }
          const alpha = 0.25;
          emaRef.current = alpha * peak + (1 - alpha) * emaRef.current;
          setLevel(Math.max(0, Math.min(1, emaRef.current)));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        // ignore; meter stays at 0
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      try { srcRef.current?.disconnect(); } catch {}
      try { analyserRef.current?.disconnect(); } catch {}
      try { ctxRef.current?.close(); } catch {}
      try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
      ctxRef.current = srcRef.current = analyserRef.current = streamRef.current = null;
    };
  }, [deviceId, enabled]);

  return level;
}
