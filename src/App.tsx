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
    background-color: #030712;
    background-image:
      radial-gradient(circle at center, #061126 0%, #030712 70%);
    font-family: 'Courier New', Courier, monospace;
    overflow: hidden;
  }

  .fairy-core {
    position: relative;
    width: 600px;
    height: 600px;
  }

  .abs-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .layer-glow {
    width: 450px;
    height: 450px;
    background: radial-gradient(circle, #0044ff 0%, transparent 60%);
    filter: blur(40px);
    opacity: 0.25;
    z-index: 0;
    transition: transform 0.1s ease-out, opacity 0.1s ease-out;
  }

  .layer-thin-ring {
    width: 380px;
    height: 380px;
    border: 2px solid #1a3a6b;
    border-radius: 50%;
    box-shadow: inset 0 0 15px rgba(0, 0, 0, 0.5);
    z-index: 10;
  }

  .layer-gyro-wrapper {
    width: 340px;
    height: 340px;
    z-index: 20;
    filter: drop-shadow(0 0 10px rgba(10, 50, 150, 0.5));
  }
  .gyro-circle {
    width: 310px;
    height: 310px;
    background: #112a57;
    border-radius: 50%;
  }
  .gyro-square {
    width: 236px;
    height: 236px;
    background: #112a57;
    border-radius: 16px;
    transform: translate(-50%, -50%) rotate(45deg);
  }

  .layer-thick-white {
    width: 280px;
    height: 280px;
    border: 40px solid #eef4fc;
    border-radius: 50%;
    box-sizing: border-box;
    box-shadow:
      0 0 25px rgba(20, 100, 255, 0.5),
      inset 0 0 15px rgba(15, 45, 110, 0.6);
    z-index: 30;
    transition: box-shadow 0.1s ease-out;
  }

  .layer-inner-blue {
    width: 200px;
    height: 200px;
    border: 30px solid #234b8c;
    border-radius: 50%;
    box-sizing: border-box;
    box-shadow: inset 0 0 25px rgba(0, 8, 25, 0.9);
    z-index: 40;
  }

  .layer-void {
    width: 140px;
    height: 140px;
    background: radial-gradient(circle, #02050b 0%, #061129 100%);
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
    transform: translate(-50%, -50%) translateY(-100px);
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
        glowRef.current.style.transform = `translate(-50%, -50%) scale(${1 + normalizedVol * 0.4})`;
        glowRef.current.style.opacity = String(0.25 + normalizedVol * 0.5);
      }

      if (thickRingRef.current) {
        const baseInner = `inset 0 0 15px rgba(15, 45, 110, 0.6)`;
        const glow = normalizedVol > 0.05
          ? `, 0 0 ${25 + normalizedVol * 60}px rgba(50, 160, 255, ${0.5 + normalizedVol * 0.4})`
          : `, 0 0 25px rgba(20, 100, 255, 0.5)`;
        thickRingRef.current.style.boxShadow = baseInner + glow;
      }

      if (ballRef.current) {
        if (normalizedVol > 0.05) {
          ballRef.current.style.boxShadow = `0 0 25px rgba(255, 255, 255, 1), 0 0 ${40 + normalizedVol * 80}px rgba(50, 180, 255, 0.9)`;
          ballRef.current.style.transform = `translate(-50%, -50%) translateY(-100px) scale(${1 + normalizedVol * 0.15})`;
        } else {
          ballRef.current.style.boxShadow = `0 0 15px rgba(255, 255, 255, 0.9), 0 0 35px rgba(50, 150, 255, 0.8)`;
          ballRef.current.style.transform = `translate(-50%, -50%) translateY(-100px) scale(1)`;
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
        <div ref={glowRef} className="abs-center layer-glow"></div>
        <div className="abs-center layer-thin-ring"></div>
        <div ref={gyroRef} className="abs-center layer-gyro-wrapper">
          <div className="abs-center gyro-circle"></div>
          <div className="abs-center gyro-square"></div>
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
