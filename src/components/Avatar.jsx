// File: src/components/Avatar.jsx
import React, { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Box3, Vector3 } from 'three';
import { useConversationStore } from '../store/useConversationStore';

// Camera follower aimed at face anchor (eye-line-ish)
function Dolly({ anchor, headH, distance, yFrac, tiltFrac }) {
  const { camera } = useThree();
  const targetPos = useRef(new Vector3());
  const targetAim = useRef(new Vector3());

  useFrame(() => {
    const [ax, ay, az] = anchor;
    const yOff = yFrac * headH;
    const aimOff = (yFrac + tiltFrac) * headH;

    targetPos.current.set(ax, ay + yOff, az + distance);
    targetAim.current.set(ax, ay + aimOff, az);

    camera.position.lerp(targetPos.current, 0.18);
    camera.lookAt(targetAim.current);
  });

  return null;
}

// Head with blink + amplitude-driven mouth
function HeadModel({ url, speaking }) {
  const { scene } = useGLTF(url);

  const mouthTargets = useRef([]);
  const blinkTargets = useRef([]);
  useEffect(() => {
    mouthTargets.current = [];
    blinkTargets.current = [];
    scene.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary && o.morphTargetInfluences) {
        const dict = o.morphTargetDictionary;
        // collect mouth blendshapes
        const mouthList = [
          'jawOpen', 'mouthOpen',
          'viseme_aa','viseme_oh','viseme_e','viseme_ih','viseme_uh',
          'lipsTogetherU'
        ].map((name) => ({ name, idx: dict[name] })).filter(x => x.idx !== undefined);
        if (mouthList.length) {
          mouthTargets.current.push({ mesh: o, infl: o.morphTargetInfluences, list: mouthList });
        }
        // collect eye blink blendshapes
        const eyes = [
          'eyeBlinkLeft', 'eyeBlinkRight', 'EyeBlinkLeft', 'EyeBlinkRight',
          'blink', 'eyesClosed'
        ].map((name) => ({ name, idx: dict[name] })).filter(x => x.idx !== undefined);
        if (eyes.length) {
          blinkTargets.current.push({ mesh: o, infl: o.morphTargetInfluences, list: eyes });
        }
      }
    });
  }, [scene]);

  // ---- Lip-sync amplitude envelope ----
  const env = useRef(-0.1);            // smoothed amplitude 0..~0.5
  const lastAmpTime = useRef(0);     // ms timestamp of last amp event (freshness)
  const fallbackT = useRef(0);

  // ---- Blink state machine ----
  const blinkVal = useRef(1);        // 0 open .. 1 closed
  const blinkNextAt = useRef(0);     // next blink timestamp (s)
  const blinkPhase = useRef('closing'); // 'idle' | 'closing' | 'opening'

  // Listen to hb-tts-level events for amplitude (from utils/tts.js)
  useEffect(() => {
    const onAmp = (e) => {
      const level = Math.max(0, Math.min(1, Number(e?.detail?.level ?? 0)));
      // smooth a bit; we keep headroom so it never fully opens
      env.current = env.current * 0.65 + (level * 0.45) * 0.85;
      lastAmpTime.current = performance.now();
    };
    const onAct = (e) => {
      if (!e?.detail?.active) {
        env.current = 0;
        lastAmpTime.current = 0;
      }
    };
    window.addEventListener('hb-tts-level', onAmp);
    window.addEventListener('hb-tts-activity', onAct);
    return () => {
      window.removeEventListener('hb-tts-level', onAmp);
      window.removeEventListener('hb-tts-activity', onAct);
    };
  }, []);

  useFrame((_, dt) => {
    // ---- Mouth: prefer fresh amplitude, else gentle fallback motion while speaking
    const fresh = (performance.now() - lastAmpTime.current) < 650;
    if (!fresh && speaking) {
      // fallback tiny movement if no amp (e.g., Web Speech path)
      fallbackT.current += dt;
      const alt = (Math.sin(fallbackT.current * 5.2) + Math.sin(fallbackT.current * 9.1)) * 0.75 * 0.12;
      env.current = env.current * 0.9 + Math.max(0, alt) * 0.1;
    }
    if (!speaking) {
      env.current += (0 - env.current) * (1 - Math.exp(-dt * 3)); // relax to closed
    }

    const amp = Math.min(0.45, Math.max(0.0, env.current)); // clamp

    // Apply to mouth blendshapes
    mouthTargets.current.forEach(({ infl, list }) => {
      list.forEach(({ name, idx }) => {
        let w;
        if (name === 'jawOpen') w = 0.90 * amp;
        else if (name === 'mouthOpen') w = 0.80 * amp;
        else if (name.startsWith('viseme_')) w = 0.95 * amp;
        else if (name === 'lipsTogetherU') w = Math.max(0, 0.55 - amp); // close lips slightly when amp is low
        else w = 0.25 * amp;

        const cur = infl[idx] || 0;
        const next = cur + (w - cur) * 0.22; // smooth
        infl[idx] = Math.max(0, Math.min(1, next));
      });
    });

    // ---- Blink: random every 2.5–5.0s, quick close/open
    const nowS = performance.now() * 0.001;
    if (blinkPhase.current === 'idle') {
      if (nowS >= blinkNextAt.current) {
        blinkPhase.current = 'closing';
      }
    }
    if (blinkPhase.current === 'closing') {
      blinkVal.current = Math.min(1, blinkVal.current + dt * 12); // ~80ms
      if (blinkVal.current >= 1) blinkPhase.current = 'opening';
    } else if (blinkPhase.current === 'opening') {
      blinkVal.current = Math.max(0, blinkVal.current - dt * 9);  // ~110ms
      if (blinkVal.current <= 0) {
        blinkPhase.current = 'idle';
        blinkNextAt.current = nowS + (2.5 + Math.random() * 2.5);
      }
    }

    // Apply blink value to any eye targets
    if (blinkTargets.current.length) {
      blinkTargets.current.forEach(({ infl, list }) => {
        list.forEach(({ idx }) => {
          const cur = infl[idx] || 0;
          const next = cur + (blinkVal.current - cur) * 0.35;
          infl[idx] = Math.max(0, Math.min(1, next));
        });
      });
    }
  });

  return <primitive object={scene} />;
}

// Compute head anchor / height / default distance once
function HeadWithFit({ url, speaking, onFit, liveAmp }) {
  const root = useRef();
  const model = useMemo(() => <HeadModel url={url} speaking={speaking} liveAmp={liveAmp} />, [url, speaking, liveAmp]);

  const { camera, size } = useThree();
  useEffect(() => {
    if (!root.current) return;

    const box = new Box3().setFromObject(root.current);
    if (box.isEmpty()) return;

    const center = new Vector3();
    box.getCenter(center);

    const headH = Math.max(0.001, box.max.y - box.min.y);
    const eyeAnchor = new Vector3(center.x, center.y + 0.10 * headH, center.z);
    const baseDist = headH * 1.35;

    camera.position.set(eyeAnchor.x, eyeAnchor.y, eyeAnchor.z + baseDist);
    camera.lookAt(eyeAnchor);

    onFit({
      anchor: [eyeAnchor.x, eyeAnchor.y, eyeAnchor.z],
      headH,
      baseDist,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, size.width, size.height, url]);

  return <group ref={root}>{model}</group>;
}

export default function Avatar() {
  const { isSpeaking } = useConversationStore();

  // persisted framing
  const [zoomFrac, setZoomFrac] = useState(() => Number(localStorage.getItem('hb_avatar_zoomFrac') ?? '0') || 0);
  const [yFrac, setYFrac]       = useState(() => Number(localStorage.getItem('hb_avatar_yFrac') ?? '0') || 0);
  const [tiltFrac, setTiltFrac] = useState(() => Number(localStorage.getItem('hb_avatar_tiltFrac') ?? '0.02') || 0.02);

  useEffect(() => { try { localStorage.setItem('hb_avatar_zoomFrac', String(zoomFrac)); } catch {} }, [zoomFrac]);
  useEffect(() => { try { localStorage.setItem('hb_avatar_yFrac', String(yFrac)); } catch {} }, [yFrac]);
  useEffect(() => { try { localStorage.setItem('hb_avatar_tiltFrac', String(tiltFrac)); } catch {} }, [tiltFrac]);

  // fit outputs
  const [anchor, setAnchor] = useState([0, 0, 0]);
  const [headH, setHeadH] = useState(1.0);
  const [baseDist, setBaseDist] = useState(2.5);

  const onFit = ({ anchor, headH, baseDist }) => {
    setAnchor(anchor);
    setHeadH(headH);
    setBaseDist(baseDist);
  };

  const distance = Math.max(0.4, baseDist * (1 - zoomFrac));

  const refit = () => { setZoomFrac(0); setYFrac(0); };

  // track freshest amplitude event (optional to surface, already handled in HeadModel)
  const [liveAmp, setLiveAmp] = useState(0);
  useEffect(() => {
    const onAmp = (e) => setLiveAmp(Number(e?.detail?.level ?? 0));
    window.addEventListener('hb-tts-level', onAmp);
    return () => window.removeEventListener('hb-tts-level', onAmp);
  }, []);

  return (
    <div className="relative bg-white rounded shadow overflow-hidden">
      {/* overlay controls */}
      <div className="absolute top-2 right-2 z-10 bg-white/90 backdrop-blur px-3 py-2 rounded shadow text-xs space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-16 text-gray-600">Zoom</span>
          <input type="range" min={-0.8} max={0.8} step={0.02} value={zoomFrac} onChange={(e) => setZoomFrac(Number(e.target.value))} />
          <span className="w-10 text-right text-gray-500">{zoomFrac.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-gray-600">Vertical</span>
          <input type="range" min={-0.35} max={0.35} step={0.01} value={yFrac} onChange={(e) => setYFrac(Number(e.target.value))} />
          <span className="w-10 text-right text-gray-500">{yFrac.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-gray-600">Tilt</span>
          <input type="range" min={-0.15} max={0.15} step={0.005} value={tiltFrac} onChange={(e) => setTiltFrac(Number(e.target.value))} />
          <span className="w-10 text-right text-gray-500">{tiltFrac.toFixed(3)}</span>
        </div>
        <button onClick={refit} className="w-full px-2 py-1 bg-slate-700 text-white rounded">Center</button>
      </div>

      <Canvas camera={{ position: [0, 0.5, 3], fov: 35 }} dpr={[1, 2]}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[2, 4, 3]} intensity={0.8} />
        <directionalLight position={[-2, 2, -2]} intensity={0.25} />
        <Suspense fallback={null}>
          <HeadWithFit url="/head-avatar.glb" speaking={isSpeaking} onFit={onFit} liveAmp={liveAmp} />
        </Suspense>
        <Dolly anchor={anchor} headH={headH} distance={distance} yFrac={yFrac} tiltFrac={tiltFrac} />
      </Canvas>
    </div>
  );
}

useGLTF.preload('/head-avatar.glb'); 