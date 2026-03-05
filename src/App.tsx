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
    width: 376px;
    height: 376px;
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
    width: 340px;
    height: 340px;
    z-index: 20;
    filter: drop-shadow(0 0 8px rgba(10, 50, 150, 0.4));
  }

  .layer-thick-white {
    width: 238px;
    height: 238px;
    border: 64px solid #ffffff;
    border-radius: 50%;
    box-sizing: border-box;
    box-shadow:
      0 0  4px  1px rgba(255, 255, 255, 0.80),
      0 0 12px  4px rgba(160, 210, 255, 0.50),
      0 0 25px  8px rgba( 50, 130, 210, 0.18);
    z-index: 30;
  }

  .layer-inner-blue {
    width: 130px;
    height: 130px;
    border: 24px solid rgb(166, 182, 219);
    border-radius: 50%;
    box-sizing: border-box;
    box-shadow: none;
    z-index: 40;
  }

  .layer-void {
    width: 56px;
    height: 56px;
    background: rgb(6, 53, 120);
    border-radius: 50%;
    box-shadow: inset 0 0 20px #000;
    z-index: 50;
  }

  .pupil-ring {
    border-radius: 50%;
    border-style: solid;
  }
  .pupil-1 { width: 90px; height: 90px; border-width: 1px; border-color: rgba(100, 180, 255, 0.15); }
  .pupil-2 { width: 50px; height: 50px; border-width: 2px; border-color: rgba(100, 180, 255, 0.25); }

  .layer-ball-rotator {
    width: 0;
    height: 0;
    z-index: 60;
  }
  .ball {
    width: 46px;
    height: 46px;
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

    // Audio
    audioSmooth: 0,
    audioPeak: 0,
    prevRawVol: 0,

    // Ripple ring-buffer: time-based, each fires at full intensity
    ripples: [] as { time: number; intensity: number }[],

    // Ball spring physics
    ballAngle: 135,
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

    // Phase accumulators
    breathPhase: 0,
    thinkPhase: 0,

    // Breath intensity: idle=0, listening/speaking=1, thinking=0.4
    breathMix: 0,
    targetBreathMix: 0,
  });

  // ═══════════════════════════════════════
  //  MAIN ANIMATION LOOP
  // ═══════════════════════════════════════
  useEffect(() => {
    const loop = () => {
      const s = stateRef.current;
      const now = Date.now();

      // ── Phases ──
      s.breathPhase += 0.015;
      if (hudState === 'thinking') s.thinkPhase += 0.04;

      // ── Off-center drift (organic non-perfect centering) ──
      const driftX = Math.sin(now / 3000) * 1.5 + Math.sin(now / 1700) * 0.5;
      const driftY = Math.cos(now / 2500) * 1.2 + Math.cos(now / 1900) * 0.4;

      // ── Continuous Ring Breathing (per-ring frequency from video analysis) ──
      // Each ring: single sine at its measured frequency. No dual-harmonic beating.
      // void ~0.5Hz, inner ~1.6Hz, white ~1.2Hz, thin ~0.9Hz
      const tSec = now / 1000;
      const bm = s.breathMix;
      const TAU = Math.PI * 2;
      const breathVoid  = Math.sin(tSec * TAU * 0.5)  * 0.04  * bm;
      const breathInner = Math.sin(tSec * TAU * 1.6)  * 0.055 * bm;
      const breathWhite = Math.sin(tSec * TAU * 1.2)  * 0.045 * bm;
      const breathThin  = Math.sin(tSec * TAU * 0.9)  * 0.03  * bm;
      const breathRing  = Math.sin(tSec * TAU * 0.5)  * 0.015 * bm;
      const breathHalo  = Math.sin(tSec * TAU * 0.3)  * 0.01  * bm;

      // ══ 1. STATE TARGETS ══
      switch (hudState) {
        case 'idle':
          s.targetGyroSpeed = 0.3;
          s.targetGlowBase = 0.70;
          s.targetHalo2Base = 0.7;
          s.targetRingBase = 0.75;
          s.targetThinBright = 0;
          s.targetBreathMix = 0.15;
          break;
        case 'listening':
          s.targetGyroSpeed = 0.6;
          s.targetGlowBase = 0.80;
          s.targetHalo2Base = 0.75;
          s.targetRingBase = 0.85;
          s.targetThinBright = 0.4;
          s.targetBreathMix = 1.0;
          break;
        case 'thinking':
          s.targetGyroSpeed = 4.5;
          s.targetGlowBase = 0.75;
          s.targetHalo2Base = 0.85;
          s.targetRingBase = 0.90;
          s.targetThinBright = 1.0;
          s.targetBreathMix = 0.4;
          break;
        case 'speaking':
          s.targetGyroSpeed = 1.2;
          s.targetGlowBase = 0.80;
          s.targetHalo2Base = 0.80;
          s.targetRingBase = 0.85;
          s.targetThinBright = 0.5;
          s.targetBreathMix = 1.0;
          break;
      }

      // ══ 2. LERP BASE VALUES ══
      const lr = 0.05;
      s.gyroSpeed += (s.targetGyroSpeed - s.gyroSpeed) * lr;
      s.glowBase += (s.targetGlowBase - s.glowBase) * lr;
      s.halo2Base += (s.targetHalo2Base - s.halo2Base) * lr;
      s.ringBase += (s.targetRingBase - s.ringBase) * lr;
      s.thinBright += (s.targetThinBright - s.thinBright) * lr;
      s.breathMix += (s.targetBreathMix - s.breathMix) * lr;

      // ══ 3. AUDIO → PEAK → RIPPLE TRIGGER ══
      let rawVol = 0;
      if ((hudState === 'listening' || hudState === 'speaking') && analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        rawVol = sum / data.length / 255;
      }
      s.audioSmooth += (rawVol - s.audioSmooth) * 0.25;
      if (rawVol > s.audioPeak) {
        s.audioPeak += (rawVol - s.audioPeak) * 0.6;
      } else {
        s.audioPeak += (rawVol - s.audioPeak) * 0.05;
      }

      // Onset detection: trigger ripple on rising edge
      let rippleTrigger = 0;
      if (rawVol > 0.08 && rawVol > s.prevRawVol * 1.15 + 0.015) {
        rippleTrigger = Math.min(rawVol * 2.5, 1.0);
      }
      s.prevRawVol = rawVol;

      // Thinking: synthetic ripple pulses
      if (hudState === 'thinking') {
        const t1 = Math.sin(s.thinkPhase * 3.7);
        const t2 = Math.sin(s.thinkPhase * 5.3);
        if (t1 + t2 > 1.3) {
          rippleTrigger = Math.max(rippleTrigger, 0.5 + Math.sin(s.thinkPhase * 11) * 0.3);
        }
      }

      // ══ 4. RIPPLE SYSTEM (time-delayed envelopes) ══
      // Fire new ripple with cooldown
      const lastRipTime = s.ripples.length > 0 ? s.ripples[s.ripples.length - 1].time : 0;
      if (rippleTrigger > 0.15 && now - lastRipTime > 80) {
        s.ripples.push({ time: now, intensity: rippleTrigger });
      }
      // Expire old ripples
      s.ripples = s.ripples.filter(r => now - r.time < 600);

      // Envelope: fast attack, quadratic decay. Each layer has a delay (ms) and duration (ms).
      const envelope = (delay: number, duration: number): number => {
        let total = 0;
        for (const rip of s.ripples) {
          const age = now - rip.time - delay;
          if (age < 0 || age > duration) continue;
          const t = age / duration;
          const env = t < 0.1 ? t / 0.1 : (1 - (t - 0.1) / 0.9) ** 2;
          total += env * rip.intensity;
        }
        return Math.min(total, 1.5);
      };

      //                      delay  duration
      const rVoid   = envelope(  0,   200);
      const rInner  = envelope( 40,   250);
      const rWhite  = envelope( 80,   300);
      const rPupil  = envelope(100,   300);
      const rThin   = envelope(140,   350);
      const rRing   = envelope(180,   400);
      const rHalo   = envelope(230,   450);

      // ══ 5. BALL — organic float around 135° ══
      // Three incommensurate frequencies → smooth, non-repeating wander
      const ballDrift = Math.sin(tSec * 0.3)  * 4
                      + Math.sin(tSec * 0.47) * 2.5
                      + Math.sin(tSec * 0.71) * 1.5;
      let ballExtra = 0;
      if (hudState === 'thinking') {
        ballExtra = Math.sin(s.thinkPhase * 0.7) * 3;
      } else if (hudState === 'speaking' || hudState === 'listening') {
        ballExtra = s.audioPeak * 5 * Math.sin(tSec * 0.8);
      }
      s.ballAngle = 135 + ballDrift + ballExtra;

      // ══ 6. GYROSCOPE ══
      const gyroMod = hudState === 'speaking' ? s.audioPeak * 1.5 : 0;
      s.gyroAngle = (s.gyroAngle + s.gyroSpeed + gyroMod) % 360;
      if (gyroRef.current) {
        gyroRef.current.style.transform = `translate(-50%, -50%) rotate(${s.gyroAngle}deg)`;
      }

      // ══ 7. APPLY TO ELEMENTS ══

      // ── Ball: angle + counter-rotate to keep face locked ──
      if (ballRotatorRef.current) {
        ballRotatorRef.current.style.transform = `translate(-50%, -50%) rotate(${s.ballAngle}deg)`;
      }
      if (ballRef.current) {
        let bScale = 1.0;
        let bGlow = '0 0 15px rgba(255,255,255,0.9), 0 0 35px rgba(50,150,255,0.8)';
        switch (hudState) {
          case 'idle':
            bScale = 0.97 + Math.sin(s.breathPhase * 0.5) * 0.03;
            break;
          case 'listening':
            bScale = 1.0 + s.audioPeak * 0.15 - rVoid * 0.12;
            bGlow = `0 0 ${15 + s.audioPeak * 30}px rgba(255,255,255,0.95), 0 0 ${35 + s.audioPeak * 50}px rgba(50,180,255,${0.8 + s.audioPeak * 0.2})`;
            break;
          case 'thinking': {
            const tp = Math.sin(s.thinkPhase * 1.5) * 0.5 + 0.5;
            bScale = 1.0 + tp * 0.06 - rVoid * 0.15;
            bGlow = `0 0 ${15 + tp * 20 + rVoid * 30}px rgba(255,255,255,1), 0 0 ${40 + tp * 30 + rVoid * 40}px rgba(50,180,255,0.9)`;
            break;
          }
          case 'speaking': {
            // Collapse on ripple, expand on audio peak
            bScale = 1.0 - rVoid * 0.2 + s.audioPeak * 0.25;
            const p = s.audioPeak;
            bGlow = `0 0 ${15 + p * 55 + rVoid * 25}px rgba(255,255,255,1), 0 0 ${35 + p * 90 + rVoid * 40}px rgba(50,180,255,${0.8 + p * 0.2})`;
            break;
          }
        }
        const counterAngle = -(s.ballAngle);
        ballRef.current.style.transform = `translate(-50%, -50%) translateY(-50px) scale(${bScale}) rotate(${counterAngle}deg)`;
        ballRef.current.style.boxShadow = bGlow;
      }

      // ── Void: breathe + COLLAPSE on ripple + drift ──
      if (voidRef.current) {
        const vScale = 1.0 + breathVoid - rVoid * 0.20;
        voidRef.current.style.transform = `translate(calc(-50% + ${driftX.toFixed(1)}px), calc(-50% + ${driftY.toFixed(1)}px)) scale(${vScale.toFixed(3)})`;
      }

      // ── Inner blue: breathe + EXPAND on ripple + drift ──
      if (innerBlueRef.current) {
        const iScale = 1.0 + breathInner + rInner * 0.14;
        const dx2 = driftX * 0.7;
        const dy2 = driftY * 0.7;
        innerBlueRef.current.style.transform = `translate(calc(-50% + ${dx2.toFixed(1)}px), calc(-50% + ${dy2.toFixed(1)}px)) scale(${iScale.toFixed(3)})`;
      }

      // ── Background disc: color FLASH on ripple ──
      if (bgDiscRef.current) {
        const f = rInner;
        bgDiscRef.current.style.background = `rgb(${Math.round(11 + f * 30)},${Math.round(46 + f * 35)},${Math.round(104 + f * 50)})`;
      }

      // ── White ring: breathe + EXPAND + glow FLARE on ripple ──
      if (thickRingRef.current) {
        const wScale = 1.0 + breathWhite + rWhite * 0.09;
        const whGlow = `0 0 ${4 + rWhite * 70}px ${1 + rWhite * 8}px rgba(255,255,255,${(0.8 + rWhite * 0.2).toFixed(2)}), 0 0 ${12 + rWhite * 60}px ${4 + rWhite * 12}px rgba(160,210,255,${(0.5 + rWhite * 0.45).toFixed(2)}), 0 0 ${25 + rWhite * 50}px ${8 + rWhite * 10}px rgba(50,130,210,${(0.18 + rWhite * 0.5).toFixed(2)})`;
        thickRingRef.current.style.boxShadow = whGlow;
        thickRingRef.current.style.transform = `translate(-50%, -50%) scale(${wScale.toFixed(4)})`;
      }

      // ── Pupil rings: EXPAND on ripple ──
      pupilRingsRef.current.forEach((ring, i) => {
        if (!ring) return;
        let pScale = 1.0;
        if (hudState === 'thinking') {
          const pulse = Math.sin(s.thinkPhase * 2 + i * 0.8);
          pScale = 1.0 + breathWhite * 0.6 + pulse * 0.08 + rPupil * (0.30 - i * 0.10);
        } else {
          pScale = 1.0 + breathWhite * 0.5 + rPupil * (0.35 - i * 0.12) + s.audioPeak * (0.06 * (2 - i));
        }
        ring.style.transform = `translate(-50%, -50%) scale(${pScale.toFixed(3)})`;
      });

      // ── Thin ring: breathe + EXPAND + border flash + glow flash ──
      if (thinRingRef.current) {
        const tScale = 1.0 + breathThin + rThin * 0.06;
        const bright = Math.min(1, s.thinBright + rThin * 0.8);
        const cr = Math.round(0x3d + (0x7a - 0x3d) * bright);
        const cg = Math.round(0x78 + (0xb8 - 0x78) * bright);
        const cb = Math.round(0xb9 + (0xe8 - 0xb9) * bright);
        thinRingRef.current.style.borderColor = `rgb(${cr},${cg},${cb})`;
        thinRingRef.current.style.boxShadow = `inset 0 0 10px rgba(0,0,0,0.5), 0 0 ${3 + rThin * 20}px ${1 + rThin * 4}px rgba(200,230,255,1), 0 0 ${8 + rThin * 25}px ${3 + rThin * 7}px rgba(120,190,255,0.85), 0 0 ${18 + rThin * 30}px ${6 + rThin * 10}px rgba(50,130,210,0.4)`;
        thinRingRef.current.style.transform = `translate(-50%, -50%) scale(${tScale.toFixed(4)})`;
      }

      // ── Glow ring: breathe + EXPAND + opacity spike ──
      if (glowRingRef.current) {
        let ringOp = s.ringBase + breathRing * 2.5;
        if (hudState === 'idle') ringOp += Math.sin(now / 2000) * 0.1;
        ringOp += rRing * 0.35;
        const grScale = 1.0 + breathRing + rRing * 0.04;
        glowRingRef.current.style.opacity = String(Math.min(1, ringOp).toFixed(3));
        glowRingRef.current.style.transform = `translate(-50%, -50%) scale(${grScale.toFixed(4)})`;
      }

      // ── Glow halo: EXPAND + opacity + flicker (thinking) ──
      if (glowRef.current) {
        let haloOp = s.glowBase;
        if (hudState === 'thinking') {
          const noise = Math.sin(s.thinkPhase * 3.7) * 0.15
            + Math.sin(s.thinkPhase * 7.3) * 0.1;
          const stepped = Math.round(noise * 6) / 6;
          haloOp = Math.max(0.55, Math.min(1.0, haloOp + stepped));
        }
        haloOp += breathHalo * 2.0 + rHalo * 0.3;
        const hScale = 1.0 + breathHalo + rHalo * 0.035;
        glowRef.current.style.opacity = String(Math.min(1, haloOp).toFixed(3));
        // Override animation transform with scale
        glowRef.current.style.transform = `translate(-50%, -50%) scale(${hScale.toFixed(4)})`;
      }

      // ── Halo2: expand on ripple ──
      if (glowHalo2Ref.current) {
        const h2Op = Math.min(1, s.halo2Base + breathHalo * 1.5 + rHalo * 0.25);
        const h2Scale = 1.0 + breathHalo * 0.8 + rHalo * 0.03;
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
          <svg width="340" height="340" viewBox="0 0 340 340" style={{display:'block'}}>
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
