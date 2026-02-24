/**
 * EVA Voice — OpenAI Realtime API (ChatGPT-level fluid conversation).
 * Phone-style UI: Call → Connected → Hang up.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

function getApiBase() {
  if (import.meta.env.VITE_EVA_API_URL)
    return `${import.meta.env.VITE_EVA_API_URL.replace(/\/$/, '')}/api`;
  if (import.meta.env.DEV) {
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
      return `${window.location.origin}/api`;
    return 'http://localhost:5002/api';
  }
  return '/api';
}
const API_BASE = getApiBase();

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const EVA_AUDIO_INPUT_KEY = 'eva_audio_input_device';

export default function ChatRealtime() {
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | error
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [callDuration, setCallDuration] = useState(0);
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => localStorage.getItem(EVA_AUDIO_INPUT_KEY) || '');
  const peerRef = useRef(null);
  const dataChannelRef = useRef(null);
  const audioRef = useRef(null);
  const durationInterval = useRef(null);
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
    setStatus('idle');
    setCallDuration(0);
  }, []);

  const startSession = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      const token = localStorage.getItem('eva_token');
      const r = await fetch(`${API_BASE}/realtime/token`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || r.statusText || 'Token failed');
      }
      const { value: ephemeralKey } = await r.json();
      if (!ephemeralKey) throw new Error('No token');

      const pc = new RTCPeerConnection();
      peerRef.current = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.style.position = 'absolute';
      audioEl.style.opacity = '0';
      document.body.appendChild(audioEl);
      audioRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        audioEl.play().catch(() => {});
      };

      const audioOpts = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (selectedDeviceId) audioOpts.deviceId = { ideal: selectedDeviceId };
      const ms = await navigator.mediaDevices.getUserMedia({ audio: audioOpts });
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

      dc.addEventListener('message', (ev) => {
        try {
          const event = JSON.parse(ev.data);
          if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
            setTranscript((t) => [...t, { role: 'user', text: event.transcript }]);
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

      const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls?model=gpt-realtime', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpRes.ok) throw new Error(`OpenAI: ${sdpRes.status}`);
      const sdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (err) {
      setError(err.message || 'Connection failed');
      setStatus('error');
      stopSession();
    }
  }, [stopSession, selectedDeviceId]);

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
            <div className="w-full max-w-xs">
              <label className="block text-slate-500 text-xs mb-1">
                🎧 Microphone (AirPods, etc.)
              </label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-600/60 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-400"
              >
                <option value="">Default</option>
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Mic ${audioDevices.indexOf(d) + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
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
          </div>
          <div className="flex-1 rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 max-h-64 overflow-y-auto space-y-3">
            {transcript.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-4">Speak…</p>
            ) : (
              transcript.map((item, i) => (
                <div key={i} className={`flex ${item.role === 'user' ? 'justify-end' : ''}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${item.role === 'user' ? 'bg-cyan-500/20 text-cyan-100' : 'bg-slate-700/60 text-slate-200'}`}>
                    <div className="text-sm whitespace-pre-wrap">{item.text}</div>
                  </div>
                </div>
              ))
            )}
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
