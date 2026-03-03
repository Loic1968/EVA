/**
 * Voice Alice — Push-to-talk voice mode.
 * Hold Space or hold the big button → record → release → Whisper STT → Claude (Alice + tools) → TTS.
 * Toggle to hands-free mode for continuous VAD.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';

const NOISE_RE = [
  /^sous-titr/i, /merci d'avoir regard/i, /abonne[z-]?/i, /subscribe/i,
  /like (and|et)/i, /^\W{0,3}$/, /^\d+$/, /musique|♪|🎵/i, /\[.*\]/,
  /regardé cette vidéo/i, /^(euh|hum|ah|oh|mmm|hmm|hm|eh|uh|um|er)+[.!?]?$/i,
];

export default function VoiceAlice() {
  const [phase, setPhase] = useState('idle');        // idle | recording | processing | speaking | error
  const [error, setError] = useState(null);
  const [msgs, setMsgs] = useState([]);              // [{role,text}]
  const [micLvl, setMicLvl] = useState(0);
  const [aliceLvl, setAliceLvl] = useState(0);
  const [history, setHistory] = useState([]);
  const [convId, setConvId] = useState(null);
  const [lang, setLang] = useState('fr');
  const [mode, setMode] = useState('vad');            // vad = hands-free (default) | ptt = push-to-talk
  const [listeningStarted, setListeningStarted] = useState(false); // VAD: true after user clicked to start (unlocks AudioContext)
  const [debug, setDebug] = useState('');

  // refs
  const stream = useRef(null);
  const actx = useRef(null);
  const analyser = useRef(null);
  const raf = useRef(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const audio = useRef(null);
  const spkInterval = useRef(null);
  const phaseRef = useRef('idle');
  const pttDown = useRef(false);
  const busy = useRef(false);
  const endRef = useRef(null);

  // VAD refs
  const vadOn = useRef(false);
  const speechT = useRef(null);
  const silenceT = useRef(null);
  const vadRec = useRef(false);
  // Barge-in: interrupt TTS as soon as user starts speaking (no need to say "stop")
  const interruptAliceRef = useRef(null);
  const bargeInStart = useRef(null);
  const BARGE_IN_RMS = 0.055;
  const BARGE_IN_MS = 280;

  const micReady = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  useEffect(() => () => cleanup(), []);

  // Open mic on mount only for PTT; VAD needs one click first (unlocks AudioContext so Alice "hears")
  useEffect(() => {
    if (mode === 'ptt') {
      openMic().then(ok => {
        micReady.current = ok;
        if (ok) log('Mic ready — maintiens Espace ou le bouton pour parler');
      });
    }
  }, [mode]);
  useEffect(() => {
    if (mode === 'vad' && listeningStarted && micReady.current) vadOn.current = true;
    if (mode === 'ptt') { vadOn.current = false; vadRec.current = false; }
  }, [mode, listeningStarted]);

  function cleanup() {
    vadOn.current = false;
    if (raf.current) cancelAnimationFrame(raf.current);
    if (stream.current) stream.current.getTracks().forEach(t => t.stop());
    if (actx.current) actx.current.close().catch(() => {});
    if (audio.current) { audio.current.pause(); audio.current = null; }
    if (spkInterval.current) clearInterval(spkInterval.current);
    stopRec();
  }

  function stopRec() {
    try { if (recorder.current?.state !== 'inactive') recorder.current?.stop(); } catch (_) {}
    recorder.current = null;
  }

  function log(s) { console.log('[VA]', s); setDebug(s); }

  // ── Open mic (once) ──
  async function openMic() {
    if (stream.current) return true;
    log('Opening mic...');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.current = s;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      actx.current = ctx;
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      analyser.current = an;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      startVU();
      log('Mic open');
      return true;
    } catch (e) {
      log('Mic error: ' + e.message);
      setError('Micro inaccessible — autorise le micro dans ton navigateur.');
      setPhase('error');
      return false;
    }
  }

  // ── VU meter loop (always runs when mic open) ──
  function startVU() {
    const data = new Float32Array(analyser.current.fftSize);
    const tick = () => {
      if (!analyser.current) return;
      analyser.current.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      setMicLvl(Math.min(100, rms * 400));

      // Barge-in: while Alice is speaking, any voice above threshold → interrupt immediately
      if (phaseRef.current === 'speaking' && rms > BARGE_IN_RMS) {
        const now = Date.now();
        if (!bargeInStart.current) bargeInStart.current = now;
        else if (now - bargeInStart.current >= BARGE_IN_MS) {
          interruptAliceRef.current?.();
          bargeInStart.current = null;
        }
      } else {
        bargeInStart.current = null;
      }

      // VAD
      if (vadOn.current && phaseRef.current === 'idle' && !busy.current) {
        doVAD(rms);
      }

      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }

  // ── VAD (hands-free) ──
  function doVAD(rms) {
    const now = Date.now();
    if (rms > 0.03) {
      silenceT.current = null;
      if (!speechT.current) speechT.current = now;
      if (!vadRec.current && now - speechT.current > 500) {
        vadRec.current = true;
        beginRecording();
        setPhase('recording');
      }
    } else if (vadRec.current) {
      if (!silenceT.current) silenceT.current = now;
      if (now - silenceT.current > 1200) {
        vadRec.current = false;
        speechT.current = null;
        silenceT.current = null;
        endRecordingAndProcess();
      }
    } else {
      if (speechT.current && now - speechT.current > 3000) speechT.current = null;
    }
    if (vadRec.current && recStartTime.current && now - recStartTime.current > 12000) {
      vadRec.current = false;
      speechT.current = null;
      silenceT.current = null;
      endRecordingAndProcess();
    }
    if (vadRec.current && speechT.current && now - speechT.current > 30000) {
      vadRec.current = false;
      speechT.current = null;
      endRecordingAndProcess();
    }
  }

  const recStartTime = useRef(0);

  // ── Start MediaRecorder ──
  function beginRecording() {
    if (!stream.current) return;
    chunks.current = [];
    recStartTime.current = Date.now();
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    const mr = new MediaRecorder(stream.current, mime ? { mimeType: mime } : {});
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    recorder.current = mr;
    mr.start(100); // collect chunks every 100ms
    log('Recording started');
  }

  // ── End recording → process ──
  function endRecordingAndProcess() {
    const mr = recorder.current;
    recorder.current = null;
    if (!mr || mr.state === 'inactive') {
      log('No recorder to stop');
      setPhase('idle');
      return;
    }
    log('Stopping recorder...');
    mr.onstop = () => {
      const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
      chunks.current = [];
      const duration = Date.now() - recStartTime.current;
      log('Blob: ' + blob.size + ' bytes, ' + duration + 'ms');
      if (blob.size < 3000 || duration < 800) {
        log('Too short (' + blob.size + 'B, ' + duration + 'ms) — hold longer');
        setError('Maintiens plus longtemps (~1 seconde minimum)');
        setPhase('idle');
        return;
      }
      processAudio(blob);
    };
    mr.stop();
  }

  // ── PTT handlers (synchronous — mic already open from mount) ──
  const onPTTDown = useCallback(() => {
    if (pttDown.current || busy.current) return;
    if (phaseRef.current === 'speaking') {
      interruptAliceRef.current?.();
      return;
    }
    if (phaseRef.current !== 'idle') return;

    if (!micReady.current) {
      // Mic not ready yet (first time, permission pending) — open async then start
      log('Waiting for mic...');
      pttDown.current = true;
      openMic().then(ok => {
        micReady.current = ok;
        if (!ok || !pttDown.current) {
          // User released before mic was ready
          pttDown.current = false;
          log('Mic failed or released too early');
          return;
        }
        beginRecording();
        setPhase('recording');
        log('Recording (delayed start)');
      });
      return;
    }

    // Mic ready — fully synchronous
    pttDown.current = true;
    beginRecording();
    setPhase('recording');
    log('Recording...');
  }, []);

  const onPTTUp = useCallback(() => {
    if (!pttDown.current) return;
    pttDown.current = false;
    log('Released');
    if (phaseRef.current === 'recording') {
      endRecordingAndProcess();
    } else {
      log('Not recording yet, skip');
    }
  }, []);

  // ── Process: STT → Claude → TTS ──
  async function processAudio(blob) {
    if (busy.current) return;
    busy.current = true;
    setPhase('processing');
    setError(null);

    // 1. Whisper STT
    let text = '';
    try {
      log('Calling Whisper STT... (blob ' + blob.size + ' bytes)');
      const r = await api.voiceStt(blob, { lang });
      text = (r.text || '').trim();
      log('STT: "' + text + '"');
    } catch (e) {
      const serverMsg = e.body?.error || e.message || 'erreur';
      log('STT error: ' + serverMsg);
      setError('STT: ' + serverMsg);
      busy.current = false;
      setPhase('idle');
      return;
    }

    // Filter noise
    if (!text || text.length < 3 || NOISE_RE.some(p => p.test(text))) {
      log('Noise filtered: "' + text + '"');
      busy.current = false;
      setPhase('idle');
      return;
    }

    // Detect language
    const fr = (text.match(/[éèêëàâùûîïçô]/gi) || []).length +
      (text.match(/\b(est|les|des|une|dans|pour|avec|qui|que|pas|mais|je|tu|il|elle|nous|vous|oui|non|bonjour|salut)\b/gi) || []).length;
    if (fr >= 2) setLang('fr');
    else if (fr === 0 && text.length > 10) setLang('en');

    // Show user msg
    setMsgs(p => [...p, { role: 'user', text }]);

    // 2. Claude (Alice + tools)
    let reply = '';
    try {
      log('Calling Claude...');
      const r = await api.chat(text, history, convId, null, { origin: 'voice' });
      reply = (r.reply || '').trim();
      log('Claude: "' + reply.slice(0, 80) + '..."');
      if (r.conversation_id) setConvId(r.conversation_id);
      setHistory(p => [...p.slice(-20), { role: 'user', content: text }, { role: 'assistant', content: reply }]);
    } catch (e) {
      const serverMsg = e.body?.error || e.message || 'erreur';
      log('Claude error: ' + serverMsg);
      setError('Claude: ' + serverMsg);
      busy.current = false;
      setPhase('idle');
      return;
    }

    if (!reply) { busy.current = false; setPhase('idle'); return; }

    // Clean for display + speech
    const clean = reply.replace(/\*?—\s*Alice\*?/g, '').replace(/\*\*/g, '').trim();
    setMsgs(p => [...p, { role: 'assistant', text: clean }]);

    // 3. Streaming TTS — play sentence-by-sentence for instant response
    setPhase('speaking');
    try {
      log('Streaming TTS...');
      const queue = [];
      let playing = false;

      const playNext = () => {
        if (queue.length === 0) { playing = false; return; }
        playing = true;
        const blob = queue.shift();
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        audio.current = a;
        spkInterval.current = setInterval(() => {
          setAliceLvl(a.paused || a.ended ? 0 : 20 + Math.random() * 60);
        }, 80);
        const done = () => {
          clearInterval(spkInterval.current);
          setAliceLvl(0);
          URL.revokeObjectURL(url);
          audio.current = null;
          playNext();
        };
        a.onended = done;
        a.onerror = done;
        a.play().catch(done);
      };

      for await (const chunk of api.voiceTtsStream(clean.slice(0, 2000))) {
        if (phaseRef.current !== 'speaking') break; // interrupted
        queue.push(chunk);
        if (!playing) playNext();
      }

      // Wait for remaining audio to finish
      await new Promise(resolve => {
        const check = () => {
          if (!playing && queue.length === 0) resolve();
          else if (phaseRef.current !== 'speaking') resolve();
          else setTimeout(check, 100);
        };
        check();
      });
      log('Audio done');
    } catch (e) {
      log('TTS error: ' + e.message);
    }

    busy.current = false;
    setPhase('idle');
  }

  function playBlob(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audio.current = a;
      spkInterval.current = setInterval(() => {
        setAliceLvl(a.paused || a.ended ? 0 : 20 + Math.random() * 60);
      }, 80);
      const done = () => {
        clearInterval(spkInterval.current);
        setAliceLvl(0);
        URL.revokeObjectURL(url);
        audio.current = null;
        resolve();
      };
      a.onended = done;
      a.onerror = done;
      a.play().catch(done);
    });
  }

  const interruptAlice = useCallback(() => {
    if (audio.current) { audio.current.pause(); audio.current = null; }
    if (spkInterval.current) clearInterval(spkInterval.current);
    setAliceLvl(0);
    busy.current = false;
    setPhase('idle');
  }, []);

  useEffect(() => {
    interruptAliceRef.current = interruptAlice;
  }, [interruptAlice]);

  // ── Toggle VAD mode ──
  const toggleMode = useCallback(async () => {
    if (mode === 'ptt') {
      const ok = await openMic();
      if (ok) {
        if (actx.current?.state === 'suspended') actx.current.resume().catch(() => {});
        vadOn.current = true;
        setListeningStarted(true);
        setMode('vad');
        log('Parle, Alice écoute (mains libres)');
      }
    } else {
      vadOn.current = false;
      vadRec.current = false;
      setMode('ptt');
    }
  }, [mode]);

  // ── Keyboard: Space PTT ──
  useEffect(() => {
    if (mode !== 'ptt') return;
    const down = (e) => {
      if (e.code === 'Space' && !e.repeat && !['INPUT','TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault(); onPTTDown();
      }
    };
    const up = (e) => {
      if (e.code === 'Space' && !['INPUT','TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault(); onPTTUp();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [mode, onPTTDown, onPTTUp]);

  // ── Render helpers ──
  const isRec = phase === 'recording';
  const isProc = phase === 'processing';
  const isSpk = phase === 'speaking';

  const scale = isRec ? 1.12 + (micLvl/100)*0.2 : isSpk ? 1.05 + (aliceLvl/100)*0.15 : 1;

  const orbCls = isRec ? 'bg-gradient-to-br from-red-500 to-rose-600 shadow-[0_0_50px_rgba(239,68,68,0.5)]'
    : isSpk ? 'bg-gradient-to-br from-violet-500 to-purple-600 shadow-[0_0_50px_rgba(139,92,246,0.5)]'
    : isProc ? 'bg-gradient-to-br from-amber-500 to-orange-500 shadow-[0_0_30px_rgba(245,158,11,0.4)]'
    : 'bg-gradient-to-br from-gray-300 to-gray-400 hover:from-gray-400 hover:to-gray-500 dark:from-gray-600 dark:to-gray-700 dark:hover:from-gray-500 dark:hover:to-gray-600 cursor-pointer';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gradient-to-b dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex flex-col text-gray-900 dark:text-white select-none"
      style={{ touchAction: 'manipulation' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <a href="/chat" className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm">← Chat</a>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isRec?'bg-red-400 animate-pulse':isSpk?'bg-violet-400 animate-pulse':isProc?'bg-amber-400 animate-pulse':'bg-gray-300 dark:bg-gray-600'}`}/>
          <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">Alice Voice</span>
          <span className="text-gray-400 dark:text-gray-600 text-[10px] uppercase">{lang}</span>
        </div>
        <button onClick={()=>{setMsgs([]);setHistory([]);setConvId(null);}} className="text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 text-xs">Effacer</button>
      </div>

      {/* Mode */}
      <div className="flex justify-center mb-1">
        <button onClick={toggleMode}
          className={`text-[11px] px-3 py-1 rounded-full border ${mode==='vad'?'border-green-500 dark:border-green-600 text-green-600 dark:text-green-400':'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
          {mode==='vad'?'🎤 Mains libres':'🎯 Push-to-talk'} <span className="text-gray-400 dark:text-gray-600 ml-1">changer</span>
        </button>
      </div>

      {/* Transcript */}
      <div className="flex-1 w-full max-w-lg mx-auto px-4 py-2 overflow-y-auto" style={{maxHeight:'38vh'}}>
        {msgs.length===0 && (
          <p className="text-gray-400 dark:text-gray-600 text-sm text-center mt-8">
            {mode==='ptt' ? <>Maintiens <kbd className="px-1 py-0.5 bg-gray-200 dark:bg-gray-800 rounded text-xs text-gray-500 dark:text-gray-400">Espace</kbd> ou le cercle pour parler</> : listeningStarted ? 'Parle, Alice écoute...' : 'Clique sur le cercle pour qu\'Alice t\'écoute'}
          </p>
        )}
        {msgs.map((m,i) => (
          <div key={i} className={`mb-2 ${m.role==='user'?'text-right':'text-left'}`}>
            <span className={`inline-block px-3 py-2 rounded-2xl text-sm max-w-[85%] select-text ${
              m.role==='user' ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-100 border border-cyan-200 dark:border-cyan-800/30'
                : 'bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-100 border border-violet-200 dark:border-violet-800/30'}`}>
              {m.text}
            </span>
          </div>
        ))}
        <div ref={endRef}/>
      </div>

      {/* Error display */}
      {error && <p className="text-red-500 dark:text-red-400 text-xs text-center px-4 mb-2">{error}</p>}

      {/* Debug line */}
      <p className="text-[9px] text-gray-400 dark:text-gray-700 text-center px-4 mb-1 font-mono truncate">{debug}</p>

      {/* VU + Orb */}
      <div className="flex flex-col items-center pb-6">
        <div className="flex gap-16 mb-3">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] text-cyan-600/60 dark:text-cyan-500/60 uppercase tracking-widest">Toi</span>
            <div className="flex items-end gap-[2px] h-6">
              {Array.from({length:12},(_,i)=>{
                const h=3+Math.min(22,(micLvl/100)*Math.sin((i/12)*Math.PI)*22);
                return <div key={i} style={{height:h,width:2}} className="bg-cyan-500/80 dark:bg-cyan-400/80 rounded-full transition-all duration-[50ms]"/>;
              })}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[9px] text-violet-600/60 dark:text-violet-500/60 uppercase tracking-widest">Alice</span>
            <div className="flex items-end gap-[2px] h-6">
              {Array.from({length:12},(_,i)=>{
                const h=3+Math.min(22,(aliceLvl/100)*Math.sin((i/12)*Math.PI)*22);
                return <div key={i} style={{height:h,width:2}} className="bg-violet-500/80 dark:bg-violet-400/80 rounded-full transition-all duration-[50ms]"/>;
              })}
            </div>
          </div>
        </div>

        <p className={`text-xs mb-3 h-5 ${isRec?'text-red-500 dark:text-red-300':isProc?'text-amber-500 dark:text-amber-300 animate-pulse':isSpk?'text-violet-500 dark:text-violet-300':'text-gray-400 dark:text-gray-600'}`}>
          {isRec?'Enregistrement...':isProc?'Alice réfléchit...':isSpk?'Alice parle...':mode==='ptt'?'Prête.':listeningStarted?'Écoute...':'Clique pour démarrer'}
        </p>

        {/* Orb — use pointer events (works mouse + touch). VAD: first click = start listening (unlocks mic). */}
        <div
          role="button"
          className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-200 ${orbCls}`}
          style={{transform:`scale(${scale})`,WebkitTapHighlightColor:'transparent'}}
          onPointerDown={async (e)=>{
            e.preventDefault();
            if (mode==='ptt') { onPTTDown(); return; }
            if (mode==='vad' && !listeningStarted) {
              const ok = await openMic();
              micReady.current = ok;
              if (ok) {
                if (actx.current?.state === 'suspended') actx.current.resume().catch(()=>{});
                setListeningStarted(true);
                vadOn.current = true;
                log('Parle, Alice écoute (mains libres)');
              }
              return;
            }
            if (mode==='vad' && recorder.current?.state === 'recording') {
              vadRec.current = false;
              silenceT.current = null;
              speechT.current = null;
              endRecordingAndProcess();
              return;
            }
            if (isSpk) interruptAlice();
          }}
          onPointerUp={(e)=>{e.preventDefault();if(mode==='ptt')onPTTUp();}}
          onPointerLeave={()=>{if(mode==='ptt')onPTTUp();}}
        >
          {isRec && <div className="absolute inset-0 rounded-full border-2 border-red-400/40 animate-ping" style={{animationDuration:'1.5s'}}/>}
          {isProc ? (
            <svg className="w-8 h-8 text-gray-400 dark:text-white/60 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round"/>
            </svg>
          ) : isSpk ? (
            <svg className="w-9 h-9 text-white/90" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>
          ) : (
            <svg className={`w-10 h-10 ${isRec?'text-white':'text-gray-400 dark:text-gray-400'}`} viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          )}
        </div>

        <p className="text-[10px] text-gray-400 dark:text-gray-700 mt-3">
          {mode==='ptt'?(isRec?'Relâche pour envoyer':'Maintiens Espace ou le cercle'):(isSpk?'Tap pour couper':isRec?'Tap pour envoyer tout de suite':listeningStarted?'Parle puis silence, ou tap pour envoyer':'Clique le cercle pour activer le micro')}
        </p>
      </div>
    </div>
  );
}
