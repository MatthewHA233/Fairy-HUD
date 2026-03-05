import React, { useState, useEffect, useRef } from 'react';

type HudState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface ControlButtonProps {
  label: string;
  state: HudState;
  current: HudState;
  set: (s: HudState) => void;
  isHighlight?: boolean;
}

const styles = `
  .hud-container {
    background-color: #010204;
    font-family: 'Courier New', Courier, monospace;
    overflow: hidden;
  }

  .fairy-core {
    position: relative;
    width: 700px;
    height: 700px;
  }

  .abs-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  /* ===== GLOW SYSTEM ===== */

  @keyframes haloWander {
    0%   { transform: translate(-50%, -50%); }
    25%  { transform: translate(calc(-50% + 3px), calc(-50% - 2px)); }
    50%  { transform: translate(calc(-50% - 2px), calc(-50% + 3px)); }
    75%  { transform: translate(calc(-50% + 2px), calc(-50% + 1px)); }
    100% { transform: translate(-50%, -50%); }
  }
  .layer-glow-halo {
    width: 460px;
    height: 460px;
    border-radius: 50%;
    background: radial-gradient(circle,
      transparent                     78%,
      rgba( 15,  60, 150, 0.06)      80%,
      rgba( 40, 130, 235, 0.95)      82.6%,
      rgba( 30, 100, 200, 0.45)      86%,
      rgba( 10,  45, 120, 0.06)      90%,
      transparent                    93%);
    filter: blur(10px);
    z-index: 0;
  }

  .layer-glow-halo2 {
    width: 450px;
    height: 450px;
    border-radius: 50%;
    background: radial-gradient(circle at 48% 46%,
      transparent                     77%,
      rgba( 20,  80, 180, 0.30)      81%,
      rgba( 50, 140, 240, 0.50)      83%,
      rgba( 20,  70, 160, 0.12)      87%,
      transparent                    91%);
    filter: blur(12px);
    z-index: 0;
    opacity: 0.7;
  }

  .layer-glow-ring {
    width: 400px;
    height: 400px;
    border-radius: 50%;
    background: radial-gradient(circle,
      transparent                    91%,
      rgba(150, 210, 255, 1.00)      95%,
      rgba( 40, 110, 200, 0.12)      98%,
      transparent                    100%);
    filter: blur(3px);
    z-index: 0;
  }

  .layer-bg-disc {
    position: absolute;
    width: 380px;
    height: 380px;
    background: rgb(11, 46, 104);
    border-radius: 50%;
    z-index: 5;
  }

  .layer-thin-ring {
    width: 380px;
    height: 380px;
    border: 2px solid #3d78b9;
    border-radius: 50%;
    box-shadow:
      inset 0 0 10px rgba(0, 0, 0, 0.5),
      0 0  3px  1px rgba(200, 230, 255, 1.00),
      0 0  8px  3px rgba(120, 190, 255, 0.85),
      0 0 18px  6px rgba( 50, 130, 210, 0.40);
    z-index: 10;
  }

  .layer-gyro-wrapper {
    width: 380px;
    height: 380px;
    z-index: 20;
    filter: drop-shadow(0 0 8px rgba(10, 50, 150, 0.4));
  }

  .layer-thick-white {
    width: 254px;
    height: 254px;
    background: #ffffff;
    border-radius: 50%;
    box-shadow:
      0 0  4px  1px rgba(255, 255, 255, 0.80),
      0 0 12px  4px rgba(160, 210, 255, 0.50),
      0 0 25px  8px rgba( 50, 130, 210, 0.18);
    z-index: 30;
  }

  .layer-inner-blue {
    width: 190px;
    height: 190px;
    background: rgb(166, 182, 219);
    border-radius: 50%;
    z-index: 35;
  }

  .layer-boundary-line {
    width: 148px;
    height: 148px;
    background: rgb(182, 216, 242);
    border-radius: 50%;
    z-index: 37;
  }

  .layer-iris {
    width: 140px;
    height: 140px;
    background: rgb(12, 97, 162);
    border-radius: 50%;
    z-index: 40;
  }

  .layer-white-outline {
    width: 104px;
    height: 104px;
    background: rgb(160, 185, 220);
    border-radius: 50%;
    z-index: 43;
  }

  .layer-void {
    width: 100px;
    height: 100px;
    background: rgb(6, 53, 120);
    border-radius: 50%;
    box-shadow: inset 0 0 20px #000;
    z-index: 50;
  }

  .pupil-ring {
    border-radius: 50%;
    border-style: solid;
  }
  .pupil-1 { width: 130px; height: 130px; border-width: 1px; border-color: rgba(100, 180, 255, 0.15); }
  .pupil-2 { width: 90px; height: 90px; border-width: 2px; border-color: rgba(100, 180, 255, 0.25); }

  .layer-ball-rotator {
    width: 0;
    height: 0;
    z-index: 60;
  }
  .ball {
    width: 62px;
    height: 62px;
    background: #ffffff;
    border-radius: 50%;
    transform: translate(-50%, -50%) translateY(-50px);
    box-shadow:
      0 0 15px rgba(255, 255, 255, 0.9),
      0 0 35px rgba(50, 150, 255, 0.8);
  }
`;

export default function App() {
  const [hudState, setHudState] = useState<HudState>('idle');
  const [micError, setMicError] = useState('');

  // ── Element refs ──
  const gyroRef = useRef<HTMLDivElement>(null);
  const ballRotatorRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const glowHalo2Ref = useRef<HTMLDivElement>(null);
  const glowRingRef = useRef<HTMLDivElement>(null);
  const thickRingRef = useRef<HTMLDivElement>(null);
  const thinRingRef = useRef<HTMLDivElement>(null);
  const innerBlueRef = useRef<HTMLDivElement>(null);
  const voidRef = useRef<HTMLDivElement>(null);
  const irisRef = useRef<HTMLDivElement>(null);
  const boundaryLineRef = useRef<HTMLDivElement>(null);
  const whiteOutlineRef = useRef<HTMLDivElement>(null);
  const bgDiscRef = useRef<HTMLDivElement>(null);
  const pupilRingsRef = useRef<(HTMLDivElement | null)[]>([]);

  // ── Audio refs ──
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const requestRef = useRef<number>(0);
  const stateRef = useRef({
    // Gyroscope
    gyroAngle: 0,
    gyroSpeed: 0.3,
    targetGyroSpeed: 0.3,

    // Ball organic float
    ballAngle: 142,
    ballVelocity: 0,

    // Per-state base values (lerped)
    glowBase: 0.70,
    targetGlowBase: 0.70,
    halo2Base: 0.7,
    targetHalo2Base: 0.7,
    ringBase: 0.75,
    targetRingBase: 0.75,
    thinBright: 0,
    targetThinBright: 0,

    // Audio analysis
    audioSmooth: 0,
    audioPeak: 0,
    prevRawVol: 0,

    // Audio-triggered ripples (listening/speaking)
    ripples: [] as { time: number; intensity: number }[],
    lastRippleTime: 0,
  });

  // ═══════════════════════════════════════
  //  MAIN ANIMATION LOOP
  // ═══════════════════════════════════════
  useEffect(() => {
    // ── Water Droplet Ripple Wave ──
    // Three-phase waveform: contract → expand → damped rebound
    // All segments join at zero crossings (no discontinuities)
    const dropletWave = (age: number, delay: number): number => {
      const t = (age - delay) / 1000; // convert ms → seconds
      if (t < 0) return 0;                                                    // wave hasn't arrived
      if (t < 0.12) return -Math.sin(Math.PI * t / 0.12) * 0.35;            // contract: quick dip
      if (t < 0.37) return  Math.sin(Math.PI * (t - 0.12) / 0.25);          // expand: full swell
      if (t < 0.87) {                                                         // rebound: damped oscillation
        const dt = t - 0.37;
        return -Math.sin(2 * Math.PI * 1.5 * dt) * Math.exp(-6 * dt) * 0.25;
      }
      return 0;                                                               // rest
    };

    const loop = () => {
      const s = stateRef.current;
      const now = Date.now();
      const tSec = now / 1000;

      // ══ 1. STATE TARGETS ══
      switch (hudState) {
        case 'idle':
          s.targetGyroSpeed = 0.3;
          s.targetGlowBase = 0.70;
          s.targetHalo2Base = 0.7;
          s.targetRingBase = 0.75;
          s.targetThinBright = 0;
          break;
        case 'listening':
          s.targetGyroSpeed = -0.6;
          s.targetGlowBase = 0.80;
          s.targetHalo2Base = 0.75;
          s.targetRingBase = 0.85;
          s.targetThinBright = 0.4;
          break;
        case 'thinking':
          s.targetGyroSpeed = 4.5;
          s.targetGlowBase = 0.75;
          s.targetHalo2Base = 0.85;
          s.targetRingBase = 0.90;
          s.targetThinBright = 1.0;
          break;
        case 'speaking':
          s.targetGyroSpeed = 1.2;
          s.targetGlowBase = 0.80;
          s.targetHalo2Base = 0.80;
          s.targetRingBase = 0.85;
          s.targetThinBright = 0.5;
          break;
      }

      // ══ 2. LERP BASE VALUES ══
      const lr = 0.05;
      s.gyroSpeed += (s.targetGyroSpeed - s.gyroSpeed) * lr;
      s.glowBase += (s.targetGlowBase - s.glowBase) * lr;
      s.halo2Base += (s.targetHalo2Base - s.halo2Base) * lr;
      s.ringBase += (s.targetRingBase - s.ringBase) * lr;
      s.thinBright += (s.targetThinBright - s.thinBright) * lr;

      // ══ 3. AUDIO ANALYSIS + ONSET DETECTION ══
      let rawVol = 0;
      if ((hudState === 'listening' || hudState === 'speaking') && analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        rawVol = sum / data.length / 255;
      }
      s.audioSmooth += (rawVol - s.audioSmooth) * 0.25;
      // audioPeak: fast attack, slow decay
      if (rawVol > s.audioPeak) s.audioPeak += (rawVol - s.audioPeak) * 0.6;
      else s.audioPeak *= 0.95;
      // onset detection
      const onset = rawVol > 0.08 && rawVol > s.prevRawVol * 1.15 + 0.015;
      s.prevRawVol = rawVol;

      // ══ 3b. RIPPLE TRIGGERING ══
      if (hudState === 'listening' && onset && now - s.lastRippleTime > 180) {
        s.ripples.push({ time: now, intensity: Math.min(rawVol * 3.5, 1) });
        s.lastRippleTime = now;
      }
      if (hudState === 'speaking' && onset && now - s.lastRippleTime > 120) {
        s.ripples.push({ time: now, intensity: Math.min(rawVol * 4.5, 1) });
        s.lastRippleTime = now;
      }
      // Silent fallback: inject weak synthetic ripple after 2s silence
      if ((hudState === 'listening' || hudState === 'speaking') && now - s.lastRippleTime > 2000) {
        s.ripples.push({ time: now, intensity: 0.5 });
        s.lastRippleTime = now;
      }
      // Expire old ripples (>1300ms)
      s.ripples = s.ripples.filter(r => now - r.time < 1300);

      // ══ 4. WATER DROPLET RIPPLE (state-differentiated) ══
      const stateMul = hudState === 'listening' ? 2.0 : hudState === 'speaking' ? 3.0 : 1.0;

      const computeWave = (delay: number, amp: number): number => {
        if (hudState === 'idle' || hudState === 'thinking') {
          return dropletWave(now % 2500, delay) * amp;
        }
        // listening / speaking: sum of audio-triggered ripples
        let total = 0;
        for (const rip of s.ripples) {
          total += dropletWave(now - rip.time, delay) * rip.intensity;
        }
        return total * amp * stateMul;
      };

      //                                        delay(ms)  amplitude
      const wVoid      = computeWave(   0, 0.08);
      const wIris      = computeWave(  50, 0.07);   // iris + boundary-line + white-outline
      const wInnerBlue = computeWave( 100, 0.055);
      const wThickWht  = computeWave( 170, 0.045);
      const wPupil1    = computeWave(  80, 0.06);
      const wPupil2    = computeWave(  60, 0.065);
      const wThinRing  = computeWave( 260, 0.03);   // thin-ring + bg-disc
      const wGlowRing  = computeWave( 320, 0.02);
      const wGlowHalo  = computeWave( 380, 0.015);

      // ══ 5. BALL — organic float around 142° ══
      const ballDrift = Math.sin(tSec * 0.3)  * 4
                      + Math.sin(tSec * 0.47) * 2.5
                      + Math.sin(tSec * 0.71) * 1.5;
      s.ballAngle = 142 + ballDrift;

      // ══ 5b. THINKING EYE DRIFT ══
      let eyeX = 0, eyeY = 0;
      if (hudState === 'thinking') {
        eyeX = Math.sin(tSec * 0.7) * 6 + Math.sin(tSec * 1.1) * 3;
        eyeY = Math.cos(tSec * 0.5) * 5 + Math.cos(tSec * 0.9) * 2;
      }

      // ══ 6. GYROSCOPE ══
      let effectiveGyroSpeed = s.gyroSpeed;
      if (hudState === 'speaking') effectiveGyroSpeed += s.audioPeak * 1.5;
      s.gyroAngle = (s.gyroAngle + effectiveGyroSpeed) % 360;
      if (gyroRef.current) {
        gyroRef.current.style.transform = `translate(-50%, -50%) rotate(${s.gyroAngle}deg)`;
      }

      // ══ 7. APPLY TO ELEMENTS ══

      // ── Ball: angle + counter-rotate + ripple scale ──
      if (ballRotatorRef.current) {
        ballRotatorRef.current.style.transform = `translate(-50%, -50%) translate(${eyeX}px, ${eyeY}px) rotate(${s.ballAngle}deg)`;
      }
      if (ballRef.current) {
        let bScale = 1.0 + wVoid; // ball follows void's wave
        if (hudState === 'listening') bScale += s.audioPeak * 0.08;
        else if (hudState === 'speaking') bScale += s.audioPeak * 0.15;
        const counterAngle = -(s.ballAngle);
        ballRef.current.style.transform = `translate(-50%, -50%) translateY(-50px) scale(${bScale}) rotate(${counterAngle}deg)`;
        // State-differentiated ball glow
        if (hudState === 'listening') {
          const spread = Math.round(35 + s.audioPeak * 20);
          ballRef.current.style.boxShadow = `0 0 15px rgba(255,255,255,0.9), 0 0 ${spread}px rgba(50,150,255,0.8)`;
        } else if (hudState === 'speaking') {
          const spread = Math.round(35 + s.audioPeak * 40);
          const brightness = (0.8 + s.audioPeak * 0.2).toFixed(2);
          ballRef.current.style.boxShadow = `0 0 15px rgba(255,255,255,0.9), 0 0 ${spread}px rgba(50,150,255,${brightness})`;
        } else {
          ballRef.current.style.boxShadow = '0 0 15px rgba(255,255,255,0.9), 0 0 35px rgba(50,150,255,0.8)';
        }
      }

      // ── Void ──
      if (voidRef.current) {
        const vScale = 1.0 + wVoid;
        voidRef.current.style.transform = `translate(-50%, -50%) translate(${eyeX}px, ${eyeY}px) scale(${vScale.toFixed(4)})`;
      }

      // ── Iris + boundary-line + white-outline: shared transform ──
      if (irisRef.current) {
        const irScale = 1.0 + wIris;
        const irisTransform = `translate(-50%, -50%) translate(${eyeX * 0.9}px, ${eyeY * 0.9}px) scale(${irScale.toFixed(4)})`;
        irisRef.current.style.transform = irisTransform;
        if (boundaryLineRef.current) boundaryLineRef.current.style.transform = irisTransform;
        if (whiteOutlineRef.current) whiteOutlineRef.current.style.transform = irisTransform;
      }

      // ── Inner blue ──
      if (innerBlueRef.current) {
        const iScale = 1.0 + wInnerBlue;
        innerBlueRef.current.style.transform = `translate(-50%, -50%) translate(${eyeX * 0.7}px, ${eyeY * 0.7}px) scale(${iScale.toFixed(4)})`;
      }

      // ── Thick white ring ──
      if (thickRingRef.current) {
        const wScale = 1.0 + wThickWht;
        thickRingRef.current.style.transform = `translate(-50%, -50%) translate(${eyeX * 0.5}px, ${eyeY * 0.5}px) scale(${wScale.toFixed(4)})`;
        // State-differentiated white ring glow
        if (hudState === 'speaking') {
          const wavePeak = Math.min(Math.abs(wThickWht) / 0.045, 1);
          const spread = Math.round(8 + wavePeak * 20);
          const alpha = (0.18 + wavePeak * 0.4).toFixed(2);
          thickRingRef.current.style.boxShadow = `0 0 4px 1px rgba(255,255,255,0.8), 0 0 12px 4px rgba(160,210,255,0.5), 0 0 ${spread}px ${Math.round(spread / 2)}px rgba(50,130,210,${alpha})`;
        } else if (hudState === 'listening') {
          const boost = s.audioPeak * 0.15;
          thickRingRef.current.style.boxShadow = `0 0 4px 1px rgba(255,255,255,${(0.8 + boost).toFixed(2)}), 0 0 12px 4px rgba(160,210,255,${(0.5 + boost).toFixed(2)}), 0 0 25px 8px rgba(50,130,210,0.18)`;
        } else {
          thickRingRef.current.style.boxShadow = '0 0 4px 1px rgba(255,255,255,0.8), 0 0 12px 4px rgba(160,210,255,0.5), 0 0 25px 8px rgba(50,130,210,0.18)';
        }
      }

      // ── Pupil rings ──
      pupilRingsRef.current.forEach((ring, i) => {
        if (!ring) return;
        const pWave = i === 0 ? wPupil1 : wPupil2;
        const pScale = 1.0 + pWave;
        ring.style.transform = `translate(-50%, -50%) translate(${eyeX}px, ${eyeY}px) scale(${pScale.toFixed(4)})`;
      });

      // ── Thin ring + bg-disc: shared wave ──
      if (thinRingRef.current) {
        const tScale = 1.0 + wThinRing;
        let bright = s.thinBright;
        // listening/speaking: wave-driven brightness boost
        if (hudState === 'listening' || hudState === 'speaking') {
          bright += Math.min(Math.abs(wThinRing / 0.03), 1) * 0.6;
        }
        bright = Math.min(bright, 1);
        const cr = Math.round(0x3d + (0x7a - 0x3d) * bright);
        const cg = Math.round(0x78 + (0xb8 - 0x78) * bright);
        const cb = Math.round(0xb9 + (0xe8 - 0xb9) * bright);
        thinRingRef.current.style.borderColor = `rgb(${cr},${cg},${cb})`;
        thinRingRef.current.style.transform = `translate(-50%, -50%) scale(${tScale.toFixed(4)})`;
        // speaking: extra glow expansion
        if (hudState === 'speaking') {
          const glowAlpha = (0.4 + Math.min(Math.abs(wThinRing / 0.03), 1) * 0.4).toFixed(2);
          thinRingRef.current.style.boxShadow = `inset 0 0 10px rgba(0,0,0,0.5), 0 0 3px 1px rgba(200,230,255,1), 0 0 8px 3px rgba(120,190,255,0.85), 0 0 18px 6px rgba(50,130,210,${glowAlpha})`;
        } else {
          thinRingRef.current.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.5), 0 0 3px 1px rgba(200,230,255,1), 0 0 8px 3px rgba(120,190,255,0.85), 0 0 18px 6px rgba(50,130,210,0.40)';
        }
      }
      if (bgDiscRef.current) {
        const bgScale = 1.0 + wThinRing;
        bgDiscRef.current.style.transform = `translate(-50%, -50%) scale(${bgScale.toFixed(4)})`;
        // speaking: color shift (RGB lighten)
        if (hudState === 'speaking') {
          const wave01 = Math.max(0, Math.min(wThinRing / 0.03, 1));
          const r = Math.round(11 + wave01 * 30);
          const g = Math.round(46 + wave01 * 35);
          const b = Math.round(104 + wave01 * 50);
          bgDiscRef.current.style.background = `rgb(${r},${g},${b})`;
        } else {
          bgDiscRef.current.style.background = 'rgb(11, 46, 104)';
        }
      }

      // ── Glow ring: opacity + wave (state-differentiated) ──
      if (glowRingRef.current) {
        let ringOp = s.ringBase + wGlowRing * 3;
        if (hudState === 'idle' || hudState === 'thinking') ringOp += Math.sin(now / 2000) * 0.1;
        if (hudState === 'listening') ringOp += s.audioSmooth * 0.15;
        if (hudState === 'speaking') ringOp += s.audioSmooth * 0.25 + wGlowRing * 3;
        const grScale = 1.0 + wGlowRing;
        glowRingRef.current.style.opacity = String(Math.min(1, ringOp).toFixed(3));
        glowRingRef.current.style.transform = `translate(-50%, -50%) scale(${grScale.toFixed(4)})`;
      }

      // ── Glow halo (state-differentiated) ──
      if (glowRef.current) {
        let haloOp = s.glowBase + wGlowHalo * 3;
        if (hudState === 'listening') haloOp += s.audioSmooth * 0.1;
        if (hudState === 'speaking') haloOp += s.audioSmooth * 0.2;
        haloOp = Math.min(1, haloOp);
        const hScale = 1.0 + wGlowHalo;
        glowRef.current.style.opacity = String(haloOp.toFixed(3));
        glowRef.current.style.transform = `translate(-50%, -50%) scale(${hScale.toFixed(4)})`;
      }

      // ── Halo2 (state-differentiated, weaker version) ──
      if (glowHalo2Ref.current) {
        let h2Op = s.halo2Base + wGlowHalo * 2;
        if (hudState === 'listening') h2Op += s.audioSmooth * 0.05;
        if (hudState === 'speaking') h2Op += s.audioSmooth * 0.1;
        h2Op = Math.min(1, h2Op);
        const h2Scale = 1.0 + wGlowHalo * 0.8;
        glowHalo2Ref.current.style.opacity = String(h2Op.toFixed(3));
        glowHalo2Ref.current.style.transform = `translate(-50%, -50%) scale(${h2Scale.toFixed(4)})`;
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [hudState]);

  // ═══════════════════════════════════════
  //  AUDIO MANAGEMENT
  // ═══════════════════════════════════════
  useEffect(() => {
    if (hudState === 'listening') {
      startMic();
    } else if (hudState === 'speaking') {
      startSpeakDemo();
    } else {
      stopAudio();
    }
    return () => stopAudio();
  }, [hudState]);

  const startMic = async () => {
    setMicError('');
    stopAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioCtxRef.current = new AudioContext();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      sourceRef.current = audioCtxRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);
    } catch (err) {
      console.error(err);
      setMicError('无法访问麦克风。请确保已授予权限以测试响应。');
      setHudState('idle');
    }
  };

  const startSpeakDemo = () => {
    stopAudio();
    const audio = new Audio('/示例说话.mp3');
    audio.loop = true;
    audioElRef.current = audio;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    const source = ctx.createMediaElementSource(audio);
    mediaSourceRef.current = source;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audio.play();
  };

  const stopAudio = () => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.src = '';
      audioElRef.current = null;
    }
    if (mediaSourceRef.current) {
      mediaSourceRef.current.disconnect();
      mediaSourceRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.mediaStream.getTracks().forEach(t => t.stop());
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  // ═══════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════
  return (
    <div className="hud-container w-full h-screen flex flex-col items-center justify-center relative">
      <style>{styles}</style>

      <div className="absolute top-8 left-8 z-50">
        <div className="text-2xl font-bold tracking-widest mb-1 text-slate-100 drop-shadow-[0_0_8px_rgba(0,100,255,0.8)]">FAIRY.SYS_CORE</div>
        <div className="text-sm border-l-4 border-cyan-400 pl-3 text-cyan-300 transition-all duration-300">
          OP_MODE: {hudState.toUpperCase()}
        </div>
        {micError && <div className="text-red-500 text-xs mt-2 bg-red-900/30 p-2 rounded border border-red-800/50">{micError}</div>}
      </div>

      <div className="fairy-core">
        {/* 辉光层 z:0 */}
        <div ref={glowRef} className="abs-center layer-glow-halo"></div>
        <div ref={glowHalo2Ref} className="abs-center layer-glow-halo2"></div>
        <div ref={glowRingRef} className="abs-center layer-glow-ring"></div>
        {/* 内盘 z:5 */}
        <div ref={bgDiscRef} className="abs-center layer-bg-disc"></div>
        <div ref={thinRingRef} className="abs-center layer-thin-ring"></div>
        <div ref={gyroRef} className="abs-center layer-gyro-wrapper">
          <svg width="380" height="380" viewBox="0 0 340 340" style={{display:'block'}}>
            <path
              d="M 151.7 27.4 L 170 5 L 188.3 27.4
                 A 145 145 0 0 1 312.6 151.7
                 L 335 170 L 312.6 188.3
                 A 145 145 0 0 1 188.3 312.6
                 L 170 335 L 151.7 312.6
                 A 145 145 0 0 1 27.4 188.3
                 L 5 170 L 27.4 151.7
                 A 145 145 0 0 1 151.7 27.4 Z"
              fill="rgb(7, 22, 72)"
            />
          </svg>
        </div>
        <div ref={thickRingRef} className="abs-center layer-thick-white"></div>
        <div ref={innerBlueRef} className="abs-center layer-inner-blue"></div>
        <div ref={boundaryLineRef} className="abs-center layer-boundary-line"></div>
        <div ref={irisRef} className="abs-center layer-iris"></div>
        <div ref={whiteOutlineRef} className="abs-center layer-white-outline"></div>
        <div ref={voidRef} className="abs-center layer-void"></div>
        <div ref={el => { pupilRingsRef.current[0] = el }} className="abs-center pupil-ring pupil-1"></div>
        <div ref={el => { pupilRingsRef.current[1] = el }} className="abs-center pupil-ring pupil-2"></div>
        <div ref={ballRotatorRef} className="abs-center layer-ball-rotator">
          <div ref={ballRef} className="abs-center ball"></div>
        </div>
      </div>

      <div className="absolute bottom-12 z-50 flex gap-4 bg-[#040b1a]/90 p-4 rounded-xl border border-blue-900/60 backdrop-blur-md shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
        <ControlButton label="待机 (IDLE)" state="idle" current={hudState} set={setHudState} />
        <ControlButton label="倾听 (LISTEN)" state="listening" current={hudState} set={setHudState} />
        <ControlButton label="思考 (THINK)" state="thinking" current={hudState} set={setHudState} />
        <ControlButton label="发声测试 (SPEAK)" state="speaking" current={hudState} set={setHudState} isHighlight />
      </div>
    </div>
  );
}

function ControlButton({ label, state, current, set, isHighlight }: ControlButtonProps) {
  const active = state === current;
  return (
    <button
      onClick={() => set(state)}
      className={`
        px-5 py-2.5 rounded font-bold text-sm tracking-widest transition-all duration-200
        ${active
          ? 'bg-blue-600/40 text-white border border-blue-400 shadow-[0_0_15px_rgba(20,100,255,0.7)]'
          : 'bg-transparent text-blue-400/50 border border-blue-900/50 hover:border-blue-600/80 hover:text-blue-200'}
        ${isHighlight && !active ? 'border-cyan-800/80 text-cyan-600/80' : ''}
      `}
    >
      {label}
    </button>
  );
}
