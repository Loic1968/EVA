/**
 * Mic & speaker test — Apple-style, equalizer bars.
 * Lets user verify mic picks up sound and speaker plays.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const BARS = 16;
const MIN_HEIGHT = 4;

export default function MicSpeakerTest({ selectedDeviceId }) {
  const [active, setActive] = useState(true);
  const [micBands, setMicBands] = useState(() => Array(BARS).fill(0));
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
    setMicBands(() => Array(BARS).fill(0));
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
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      analyser.minDecibels = -60;
      analyser.maxDecibels = -10;
      src.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const bucketSize = Math.floor(data.length / BARS);

      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(data);
        const bands = [];
        for (let b = 0; b < BARS; b++) {
          let max = 0;
          const start = b * bucketSize;
          const end = Math.min(start + bucketSize, data.length);
          for (let i = start; i < end; i++) if (data[i] > max) max = data[i];
          bands.push(Math.min(100, (max / 64) * 120));
        }
        setMicBands(bands);
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

  const barHeights = micBands.map((v) => MIN_HEIGHT + Math.min(28, (v / 100) * 28));

  return (
    <div className="w-full max-w-xs">
      <button
        type="button"
        onClick={() => setActive((a) => !a)}
        className="w-full py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-600/60 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 text-sm flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors"
      >
        <span>🎤 Test microphone & speaker</span>
        <span className="text-xs">{active ? '▼' : '▶'}</span>
      </button>
      {active && (
        <div className="mt-3 p-4 rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/40 space-y-4">
          {/* Mic equalizer — live frequency bands */}
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Microphone — speak to see levels</p>
            <div className="flex items-end justify-center gap-0.5 h-10 px-3 py-2 rounded-lg bg-slate-900/70 dark:bg-slate-950/80 border border-slate-600/40">
              {barHeights.map((h, i) => (
                <div
                  key={i}
                  className="w-1.5 rounded-full min-h-[4px] bg-emerald-400 dark:bg-emerald-300 transition-[height] duration-75"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={toggleMicTest}
              className="mt-2 w-full py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium"
            >
              {micTesting ? 'Stop mic test' : 'Start mic test'}
            </button>
          </div>
          {/* Speaker test */}
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Speaker — play a tone</p>
            <button
              type="button"
              onClick={playSpeakerTest}
              className="w-full py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-700 dark:text-blue-300 text-sm font-medium flex items-center justify-center gap-2"
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
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            If mic bars don't move when you speak, check permissions or try another device.
          </p>
        </div>
      )}
    </div>
  );
}
