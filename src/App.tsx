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

  /* ===== GLOW SYSTEM =====
     双层环形渐变 + 紧凑 blur，集中在环边，快速衰减到纯黑。
  */

  /* ── 弥散辉光 ──
     460px = 230px 半径；82.6% = 190px = 环边
     窄梯度 + 小 blur → 集中、饱和、快速衰减  */
  @keyframes haloWander {
    0%   { transform: translate(-50%, -50%); opacity: 0.92; }
    25%  { transform: translate(calc(-50% + 3px), calc(-50% - 2px)); opacity: 1.00; }
    50%  { transform: translate(calc(-50% - 2px), calc(-50% + 3px)); opacity: 0.94; }
    75%  { transform: translate(calc(-50% + 2px), calc(-50% + 1px)); opacity: 0.97; }
    100% { transform: translate(-50%, -50%); opacity: 0.92; }
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
    animation: haloWander 8s ease-in-out infinite;
    z-index: 0;
    transition: opacity 0.15s ease-out;
  }

  /* ── 第二层辉光 — 略偏移，制造非均匀感 ── */
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

  /* ── 环边亮带 — 极窄高亮 ──
     400px = 200px 半径；95% = 190px */
  @keyframes ringPulse {
    0%   { opacity: 0.88; }
    50%  { opacity: 1.00; }
    100% { opacity: 0.88; }
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
    animation: ringPulse 3.5s ease-in-out infinite;
    animation-delay: -1s;
    z-index: 0;
  }

  /* 背景圆盘 */
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
    transition: box-shadow 0.1s ease-out;
  }

  .layer-inner-blue {
    width: 168px;
    height: 168px;
    border: 24px solid rgb(166, 182, 219);
    border-radius: 50%;
    box-sizing: border-box;
    box-shadow: none;
    z-index: 40;
  }

  .layer-void {
    width: 72px;
    height: 72px;
    background: rgb(6, 53, 120);
    border-radius: 50%;
    box-shadow: inset 0 0 20px #000;
    z-index: 50;
  }

  .pupil-ring {
    border-radius: 50%;
    border-style: solid;
    transition: transform 0.1s ease-out;
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
    transition: transform 0.1s ease-out, box-shadow 0.1s ease-out;
  }
`;

export default function App() {
  const [hudState, setHudState] = useState<HudState>('idle');
  const [micError, setMicError] = useState('');

  const gyroRef = useRef<HTMLDivElement>(null);
  const ballRotatorRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const thickRingRef = useRef<HTMLDivElement>(null);
  const pupilRingsRef = useRef<(HTMLDivElement | null)[]>([]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const requestRef = useRef<number>(0);
  const stateRef = useRef({
    gyroAngle: 0,
    currentGyroSpeed: 0.3,
    targetGyroSpeed: 0.3,
    audioSmoothData: 0
  });

  useEffect(() => {
    const loop = () => {
      const s = stateRef.current;

      if (hudState === 'idle') s.targetGyroSpeed = 0.4;
      else if (hudState === 'listening') s.targetGyroSpeed = 0.8;
      else if (hudState === 'thinking') s.targetGyroSpeed = 5.0;
      else if (hudState === 'speaking') s.targetGyroSpeed = 1.0;

      s.currentGyroSpeed += (s.targetGyroSpeed - s.currentGyroSpeed) * 0.05;
      s.gyroAngle = (s.gyroAngle + s.currentGyroSpeed) % 360;

      if (gyroRef.current) {
        gyroRef.current.style.transform = `translate(-50%, -50%) rotate(${s.gyroAngle}deg)`;
      }

      const baseBallAngle = 135;
      const organicWiggle = Math.sin(Date.now() / 800) * 1.5;
      if (ballRotatorRef.current) {
        ballRotatorRef.current.style.transform = `translate(-50%, -50%) rotate(${baseBallAngle + organicWiggle}deg)`;
      }

      let volume = 0;
      if (hudState === 'speaking' && analyserRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        volume = sum / dataArray.length;
      }

      s.audioSmoothData += (volume - s.audioSmoothData) * 0.25;
      const normalizedVol = s.audioSmoothData / 255;

      if (glowRef.current) {
        glowRef.current.style.opacity = String(0.85 + normalizedVol * 0.15);
      }

      if (thickRingRef.current) {
        const glow = normalizedVol > 0.05
          ? `0 0 ${25 + normalizedVol * 60}px rgba(50, 160, 255, ${0.5 + normalizedVol * 0.4})`
          : `0 0 25px rgba(20, 100, 255, 0.5)`;
        thickRingRef.current.style.boxShadow = glow;
      }

      if (ballRef.current) {
        if (normalizedVol > 0.05) {
          ballRef.current.style.boxShadow = `0 0 25px rgba(255, 255, 255, 1), 0 0 ${40 + normalizedVol * 80}px rgba(50, 180, 255, 0.9)`;
          ballRef.current.style.transform = `translate(-50%, -50%) translateY(-50px) scale(${1 + normalizedVol * 0.15})`;
        } else {
          ballRef.current.style.boxShadow = `0 0 15px rgba(255, 255, 255, 0.9), 0 0 35px rgba(50, 150, 255, 0.8)`;
          ballRef.current.style.transform = `translate(-50%, -50%) translateY(-50px) scale(1)`;
        }
      }

      pupilRingsRef.current.forEach((ring, index) => {
        if (ring) {
          const scaleFactor = 1 + (normalizedVol * (0.05 * (2 - index)));
          ring.style.transform = `translate(-50%, -50%) scale(${scaleFactor})`;
        }
      });

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [hudState]);

  useEffect(() => {
    if (hudState === 'speaking') {
      startMic();
    } else {
      stopMic();
    }
    return () => stopMic();
  }, [hudState]);

  const startMic = async () => {
    setMicError('');
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

  const stopMic = () => {
    if (sourceRef.current) {
      sourceRef.current.mediaStream.getTracks().forEach(t => t.stop());
      sourceRef.current.disconnect();
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
    }
    analyserRef.current = null;
  };

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
        <div className="abs-center layer-glow-halo2"></div>
        <div className="abs-center layer-glow-ring"></div>
        {/* 内盘遮挡 z:5 */}
        <div className="abs-center layer-bg-disc"></div>
        <div className="abs-center layer-thin-ring"></div>
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
        <div className="abs-center layer-inner-blue"></div>
        <div className="abs-center layer-void"></div>
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
