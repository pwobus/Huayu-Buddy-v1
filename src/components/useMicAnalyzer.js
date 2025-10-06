import { useEffect, useState } from 'react';

export default function useMicAnalyzer(isSpeaking) {
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    if (!isSpeaking) return;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 512;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray);
        const amplitude = Math.max(...dataArray) - 128;
        setVolume(Math.abs(amplitude) / 128);
        requestAnimationFrame(tick);
      };
      tick();
    });

    return () => audioCtx.close();
  }, [isSpeaking]);

  return volume;
}
