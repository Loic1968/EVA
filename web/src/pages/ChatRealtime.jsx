/**
 * EVA Voice — OpenAI Realtime API (ChatGPT-level fluid conversation).
 * Phone-style UI: Call → Connected → Hang up.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import MicSpeakerTest from '../components/MicSpeakerTest';

function getApiBase() {
  if (import.meta.env.VITE_EVA_API_URL)
    return `${import.meta.env.VITE_EVA_API_URL.replace(/\/$/, '')}/api`;
  if (import.meta.env.DEV && typeof window !== 'undefined')
    return `${window.location.origin}/api`;
  return '/api';
}
const API_BASE = getApiBase();

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const EVA_AUDIO_INPUT_KEY = 'eva_audio_input_device';
const EVA_AUDIO_OUTPUT_KEY = 'eva_audio_output_device';

export default function ChatRealtime() {
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | error
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [callDuration, setCallDuration] = useState(0);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => localStorage.getItem(EVA_AUDIO_INPUT_KEY) || '');
  const [outputDeviceId, setOutputDeviceId] = useState(() => localStorage.getItem(EVA_AUDIO_OUTPUT_KEY) || '');
  const peerRef = useRef(null);
  const dataChannelRef = useRef(null);
  const audioRef = useRef(null);
  const durationInterval = useRef(null);
  const micStreamRef = useRef(null);
  const evaStreamRef = useRef(null);
  const [liveMicLevel, setLiveMicLevel] = useState(0);
  const [liveEvaLevel, setLiveEvaLevel] = useState(0);
  const [hasEvaStream, setHasEvaStream] = useState(false);
  const [isEvaThinking, setIsEvaThinking] = useState(false);
  const outputDeviceRef = useRef(outputDeviceId);
  const stopEvaRef = useRef(null);
  const baseInstructionsRef = useRef(null);

  // Client-side: cancel immediately if this might need web search — no compromise, never play wrong answer first
  const MIGHT_NEED_WEB = /\b(?:vols?|flights?|actualit[eé]s?|quoi\s*de\s*neuf|latest\s*news?|donne[s]?\s*moi\s*(?:les\s*)?vols?|prochains?\s*vols?|cherche\s*(?:sur\s*)?(?:le\s*)?web|prix\s*(?:des?\s*)?vols?)\b|\b(?:dubai|paris|new\s*york|london|shanghai)\b.*\b(?:dubai|paris|new\s*york|london|shanghai)\b/i;

  const STOP_PHRASES = [
    'stop', 'arrête', 'tais-toi', 'tais toi', 'tais-toi.', 'tais toi.',
    'stop talking', 'stop talking.', 'be quiet', 'silence', 'chut',
    'arrete', 'arrête de parler', 'stop de parler',
  ];
  const isStopCommand = (text) => {
    const t = (text || '').toLowerCase().trim().replace(/[.!?]+$/, '');
    return STOP_PHRASES.some((p) => t === p || t.endsWith(' ' + p) || t.startsWith(p + ' '));
  };
  outputDeviceRef.current = outputDeviceId;
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const inputs = devs.filter((d) => d.kind === 'audioinput');
        if (!cancelled) setAudioDevices(inputs);
      } catch (_) {}
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const stopSession = useCallback(() => {
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
      durationInterval.current = null;
    }
    const el = audioRef.current;
    if (el?.parentNode) el.parentNode.removeChild(el);
    audioRef.current = null;
    const dc = dataChannelRef.current;
    if (dc) {
      dc.close();
      dataChannelRef.current = null;
    }
    const pc = peerRef.current;
    if (pc) {
      pc.getSenders?.().forEach((s) => s.track?.stop());
      pc.close();
      peerRef.current = null;
    }
    micStreamRef.current = null;
    evaStreamRef.current = null;
    stopEvaRef.current = null;
    setHasEvaStream(false);
    setLiveMicLevel(0);
    setLiveEvaLevel(0);
    setIsEvaThinking(false);
    setStatus('idle');
    setCallDuration(0);
  }, []);

  const startSession = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      const token = localStorage.getItem('eva_token') || sessionStorage.getItem('eva_token');
      const r = await fetch(`${API_BASE}/realtime/token`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data.error || r.statusText;
        if (r.status === 401) throw new Error('Connecte-toi d\'abord (page Login). En dev: EVA_SKIP_AUTH=true dans .env.');
        if (r.status === 503) throw new Error(msg || 'OPENAI_API_KEY manquant ou EVA en pause.');
        throw new Error(msg || 'Token failed');
      }
      const ephemeralKey = data.value ?? data.client_secret?.value ?? data.client_secret;
      if (!ephemeralKey || typeof ephemeralKey !== 'string') throw new Error('Réponse token invalide.');
      baseInstructionsRef.current = data.instructions || null;

      const pc = new RTCPeerConnection();
      peerRef.current = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.style.position = 'absolute';
      audioEl.style.opacity = '0';
      document.body.appendChild(audioEl);
      audioRef.current = audioEl;
      pc.ontrack = async (e) => {
        const stream = e.streams[0];
        audioEl.srcObject = stream;
        evaStreamRef.current = stream;
        setHasEvaStream(true);
        const outId = outputDeviceRef.current;
        if (outId && typeof audioEl.setSinkId === 'function') {
          try {
            await audioEl.setSinkId(outId);
          } catch (_) {}
        }
        audioEl.play().catch(() => {});
      };

      const audioOpts = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (selectedDeviceId) audioOpts.deviceId = { ideal: selectedDeviceId };
      const ms = await navigator.mediaDevices.getUserMedia({ audio: audioOpts });
      micStreamRef.current = ms;
      localStorage.setItem(EVA_AUDIO_INPUT_KEY, selectedDeviceId);
      pc.addTrack(ms.getTracks()[0]);

      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;
      setTranscript([]);

      dc.addEventListener('open', () => {
        setStatus('connected');
        setCallDuration(0);
        durationInterval.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
      });

      const stopEvaSpeaking = () => {
        const el = audioRef.current;
        if (el) {
          el.pause();
          el.currentTime = 0;
        }
        const d = dataChannelRef.current;
        if (d?.readyState === 'open') {
          try {
            d.send(JSON.stringify({ type: 'response.cancel' }));
            d.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));
          } catch (_) {}
        }
        setIsEvaThinking(false);
      };
      stopEvaRef.current = stopEvaSpeaking;

      dc.addEventListener('message', (ev) => {
        try {
          const event = JSON.parse(ev.data);
          if (event.type === 'response.created') {
            setIsEvaThinking(true);
            audioRef.current?.play().catch(() => {});
          } else if (event.type === 'response.done' || event.type === 'response.output_item.added') {
            setIsEvaThinking(false);
            if (event.type === 'response.output_item.added') audioRef.current?.play().catch(() => {});
          }
          if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
            const txt = event.transcript;
            setTranscript((t) => [...t, { role: 'user', text: txt }]);
            if (isStopCommand(txt)) {
              stopEvaSpeaking();
            } else if (MIGHT_NEED_WEB.test(txt)) {
              // Tavily voice — no compromise: cancel auto-response immediately, wait for web results, then answer
              const base = baseInstructionsRef.current;
              const dc = dataChannelRef.current;
              if (base && dc?.readyState === 'open') {
                stopEvaSpeaking();
                (async () => {
                  try {
                    const token = localStorage.getItem('eva_token') || sessionStorage.getItem('eva_token');
                    const r = await fetch(`${API_BASE}/realtime/web-assist`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                      body: JSON.stringify({ transcript: txt }),
                    });
                    const { webContext } = await r.json().catch(() => ({}));
                    const d = dataChannelRef.current;
                    if (d?.readyState !== 'open') return;
                    const instructions = webContext ? base + webContext : base;
                    d.send(JSON.stringify({ type: 'response.create', instructions }));
                  } catch (_) {
                    const d = dataChannelRef.current;
                    if (d?.readyState === 'open' && base) {
                      d.send(JSON.stringify({ type: 'response.create', instructions: base }));
                    }
                  }
                })();
              }
            }
          } else if (event.type === 'conversation.item.added' && event.item?.role === 'assistant') {
            const content = event.item?.content?.[0];
            if (content?.transcript) {
              setTranscript((t) => [...t, { role: 'assistant', text: content.transcript }]);
            } else if (content?.text) {
              setTranscript((t) => [...t, { role: 'assistant', text: content.text }]);
            }
          } else if (event.type === 'conversation.item.done' && event.item?.role === 'assistant') {
            const content = event.item?.content?.[0];
            if (content?.transcript || content?.text) {
              setTranscript((t) => {
                const text = content.transcript || content.text;
                const last = t[t.length - 1];
                if (last?.role === 'assistant' && last.text !== text) return [...t.slice(0, -1), { role: 'assistant', text }];
                if (last?.role === 'assistant' && last.text === text) return t;
                return [...t, { role: 'assistant', text }];
              });
            }
          }
        } catch (_) {}
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpRes.ok) {
        const errText = await sdpRes.text();
        let errMsg = `OpenAI: ${sdpRes.status}`;
        try { const e = JSON.parse(errText); errMsg = e.error?.message || e.error || errMsg; } catch (_) {}
        throw new Error(errMsg);
      }
      const sdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (err) {
      setError(err.message || 'Connection failed');
      setStatus('error');
      stopSession();
    }
  }, [stopSession, selectedDeviceId]);

  // Live mic level (when you speak)
  useEffect(() => {
    if (status !== 'connected' || !micStreamRef.current) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(micStreamRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let rafId;
    const tick = () => {
      if (!micStreamRef.current) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLiveMicLevel(Math.min(100, (avg / 128) * 100));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      ctx.close();
    };
  }, [status]);

  // Live EVA output level (when EVA speaks)
  useEffect(() => {
    if (status !== 'connected' || !evaStreamRef.current) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(evaStreamRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let rafId;
    const tick = () => {
      if (!evaStreamRef.current) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLiveEvaLevel(Math.min(100, (avg / 128) * 100));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      ctx.close();
    };
  }, [status, hasEvaStream]);

  useEffect(() => () => stopSession(), [stopSession]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100dvh-8rem)] sm:min-h-[calc(100vh-8rem)] py-6">
      {status === 'idle' || status === 'error' ? (
        <div className="flex flex-col items-center gap-6">
          <div className="w-24 h-24 rounded-full bg-slate-700/60 flex items-center justify-center">
            <span className="text-4xl">📞</span>
          </div>
          <h2 className="text-xl font-semibold text-white">Call EVA</h2>
          <p className="text-slate-400 text-sm text-center max-w-xs">
            Live voice conversation (like ChatGPT)
          </p>
          {audioDevices.length > 0 && (
            <div className="w-full max-w-xs space-y-2">
              <div>
                <label className="block text-slate-500 text-xs mb-1">
                  🎤 Micro (entrée)
                </label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedDeviceId(v);
                    localStorage.setItem(EVA_AUDIO_INPUT_KEY, v);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-600/60 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-400"
                >
                  <option value="">Par défaut</option>
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Micro ${audioDevices.indexOf(d) + 1}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-500 text-xs mb-1">
                  🔊 Sortie (où EVA parle)
                </label>
                {typeof navigator?.mediaDevices?.selectAudioOutput === 'function' ? (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const dev = await navigator.mediaDevices.selectAudioOutput();
                        setOutputDeviceId(dev.deviceId);
                        localStorage.setItem(EVA_AUDIO_OUTPUT_KEY, dev.deviceId);
                      } catch (e) {
                        if (e.name !== 'AbortError') console.warn('[EVA] selectAudioOutput:', e);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-600/60 text-slate-200 text-sm text-left hover:bg-slate-700/80 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  >
                    {outputDeviceId ? '✓ Sortie choisie' : 'Choisir (MacBook, écouteurs…)'}
                  </button>
                ) : (
                  <p className="text-slate-500 text-xs">
                    Si le son part sur ton téléphone : clic sur l’icône son macOS → choisis « MacBook » ou tes écouteurs.
                  </p>
                )}
              </div>
            </div>
          )}
          <MicSpeakerTest selectedDeviceId={selectedDeviceId || undefined} />
          <button
            onClick={startSession}
            className="w-20 h-20 min-w-[72px] min-h-[72px] rounded-full bg-emerald-500 hover:bg-emerald-400 text-white flex items-center justify-center text-2xl shadow-lg shadow-emerald-500/30 transition-all hover:scale-105 active:scale-95 touch-manipulation"
            title="Call"
          >
            <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
          </button>
        </div>
      ) : status === 'connecting' ? (
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          <p className="text-slate-400">Connecting…</p>
        </div>
      ) : (
        <div className="flex flex-col w-full max-w-lg">
          <div className="flex flex-col items-center py-6 gap-2">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <span className="w-4 h-4 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <p className="text-emerald-400 font-medium">Connected</p>
            <p className="text-slate-500 text-sm font-mono">{formatDuration(callDuration)}</p>
            {/* EVA thinking indicator */}
            {isEvaThinking && (
              <div className="flex items-center gap-2 mt-2 px-4 py-2 rounded-full bg-amber-500/20 border border-amber-500/40">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-300 text-xs font-medium">EVA is thinking…</span>
              </div>
            )}
            {/* Level visualizers: You (mic) + EVA (output) */}
            <div className="flex items-center gap-8 mt-4">
              <div className="flex flex-col items-center gap-1">
                <p className="text-[10px] text-cyan-400 font-medium">You</p>
                <div className="flex items-end justify-center gap-0.5 h-8">
                  {Array.from({ length: 12 }, (_, i) => {
                    const v = (liveMicLevel / 100) * (Math.sin((i / 12) * Math.PI) * 0.25 + 0.75);
                    const h = 4 + Math.min(24, v * 24);
                    return (
                      <div
                        key={i}
                        className="w-1.5 rounded-sm bg-cyan-500/90 transition-all duration-75"
                        style={{ height: `${h}px` }}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col items-center gap-1">
                <p className="text-[10px] text-violet-400 font-medium">EVA</p>
                <div className="flex items-end justify-center gap-0.5 h-8">
                  {Array.from({ length: 12 }, (_, i) => {
                    const v = (liveEvaLevel / 100) * (Math.sin((i / 12) * Math.PI) * 0.25 + 0.75);
                    const h = 4 + Math.min(24, v * 24);
                    return (
                      <div
                        key={i}
                        className="w-1.5 rounded-sm bg-violet-500/90 transition-all duration-75"
                        style={{ height: `${h}px` }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
            {/* Stop EVA button — say "tais-toi" or "stop" to interrupt, or click */}
            {(isEvaThinking || liveEvaLevel > 5) && (
              <button
                type="button"
                onClick={() => stopEvaRef.current?.()}
                className="mt-3 px-4 py-2 rounded-lg bg-red-500/30 hover:bg-red-500/50 text-red-300 text-sm font-medium border border-red-500/50 transition-colors"
              >
                Stop EVA
              </button>
            )}
          </div>
          <div className="flex-1 rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 max-h-64 overflow-y-auto space-y-3">
            {transcript.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">
                Speak… Say <span className="text-cyan-400">tais-toi</span> or <span className="text-cyan-400">stop</span> to interrupt EVA.
              </p>
            ) : (
              transcript.map((item, i) => (
                <div key={i} className={`flex ${item.role === 'user' ? 'justify-end' : ''}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${item.role === 'user' ? 'bg-cyan-500/20 text-cyan-100' : 'bg-slate-700/60 text-slate-200'}`}>
                    <div className="text-sm whitespace-pre-wrap">{item.text}</div>
                  </div>
                </div>
              ))
            )}
            <p className="text-[10px] text-slate-500 text-center pt-2 border-t border-slate-700/40 mt-2">
              Say tais-toi or stop to interrupt
            </p>
          </div>
          <button
            onClick={stopSession}
            className="mt-6 w-16 h-16 min-w-[56px] min-h-[56px] rounded-full bg-red-500/30 hover:bg-red-500/50 text-red-300 mx-auto flex items-center justify-center transition-colors touch-manipulation"
            title="Hang up"
          >
            <svg className="w-8 h-8 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 px-4 py-2 rounded-lg bg-red-500/10 text-red-400 text-sm text-center max-w-sm">{error}</div>
      )}
    </div>
  );
}
