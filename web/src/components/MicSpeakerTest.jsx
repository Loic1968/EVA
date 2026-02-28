/**
 * Mic & speaker test — Apple-style, equalizer bars.
 * Lets user verify mic picks up sound and speaker plays.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const BARS = 8;
const MIN_HEIGHT = 4;

export default function MicSpeakerTest({ selectedDeviceId }) {
  const [active, setActive] = useState(true);
  const [micLevel, setMicLevel] = useState(0);
  const [micTesting, setMicTesting] = useState(false);
  const [speakerPlayed, setSpeakerPlayed] = useState(false);
  const [error, setError] = useState(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const ctxRef = useRef(null);
  const rafRef = useRef(null);

  const stopMic = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (analyserRef.current && ctxRef.current) {
      ctxRef.current.close();
      analyserRef.current = null;
      ctxRef.current = null;
    }
    setMicLevel(0);
    setMicTesting(false);
  }, []);

  const startMicTest = useCallback(async () => {
    setError(null);
    stopMic();
    try {
      const opts = { echoCancellation: false, noiseSuppression: false };
      if (selectedDeviceId) opts.deviceId = { ideal: selectedDeviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: opts });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      src.connect(analyser);
      analyserRef.current = analyser;
      const timeData = new Uint8Array(analyser.fftSize);

      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getByteTimeDomainData(timeData);
        let sum = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / timeData.length);
        const level = Math.min(100, rms * 600);
        setMicLevel(level);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      setMicTesting(true);
    } catch (e) {
      setError(e.message || 'Mic access denied');
    }
  }, [selectedDeviceId, stopMic]);

  const toggleMicTest = useCallback(() => {
    if (micTesting) stopMic();
    else startMicTest();
  }, [micTesting, stopMic, startMicTest]);

  const playSpeakerTest = useCallback(() => {
    setError(null);
    setSpeakerPlayed(false);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 440;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
      setSpeakerPlayed(true);
      setTimeout(() => setSpeakerPlayed(false), 600);
    } catch (e) {
      setError(e.message || 'Speaker test failed');
    }
  }, []);

  useEffect(() => () => stopMic(), [stopMic]);

  const barHeights = Array(BARS)
    .fill(0)
    .map((_, i) => {
      const offset = Math.sin((i / BARS) * Math.PI) * 0.3 + 0.7;
      const v = (micLevel / 100) * offset;
      return MIN_HEIGHT + Math.min(28, v * 28);
    });

  return (
    <div className="w-full max-w-xs">
      <button
        type="button"
        onClick={() => setActive((a) => !a)}
        className="w-full py-2 px-3 rounded-lg border border-slate-600/60 bg-slate-800/50 text-slate-400 text-sm flex items-center justify-between hover:bg-slate-800/80 transition-colors"
      >
        <span>🎤 Test microphone & speaker</span>
        <span className="text-xs">{active ? '▼' : '▶'}</span>
      </button>
      {active && (
        <div className="mt-3 p-4 rounded-xl bg-slate-800/50 border border-slate-700/40 space-y-4">
          {/* Mic equalizer */}
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Micro — clique Démarrer puis parle</p>
            <div className="flex items-end justify-center gap-1 h-8">
              {barHeights.map((h, i) => (
                <div
                  key={i}
                  className="w-2 rounded-sm bg-emerald-500 dark:bg-emerald-400 transition-all duration-75"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={toggleMicTest}
              className="mt-2 w-full py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium"
            >
              {micTesting ? 'Arrêter' : 'Démarrer'}
            </button>
          </div>
          {/* Speaker test */}
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Speaker — play a tone</p>
            <button
              type="button"
              onClick={playSpeakerTest}
              className="w-full py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-sm font-medium flex items-center justify-center gap-2"
            >
              {speakerPlayed ? (
                <>
                  <span className="w-2 h-4 bg-blue-500 animate-pulse" /> Playing…
                </>
              ) : (
                '▶ Play test tone'
              )}
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Si les barres ne bougent pas : autorise le micro (navigateur) ou change d&apos;appareil.
          </p>
        </div>
      )}
    </div>
  );
}
