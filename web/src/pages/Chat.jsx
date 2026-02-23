import { useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useVoiceInput, useVoiceOutput } from '../hooks/useVoice';

function nextSentence(text, fromIndex) {
  const rest = text.slice(fromIndex).trimStart();
  const m = rest.match(/^[^.!?\n]*[.!?\n]/);
  return m ? m[0].trim() : (rest.length >= 50 ? rest.slice(0, 80).trim() : null);
}

export default function Chat() {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [evaEnabled, setEvaEnabled] = useState(true);
  const [streamingContent, setStreamingContent] = useState('');
  const [autoPlayVoice, setAutoPlayVoice] = useState(true);
  const lang = navigator.language?.startsWith('fr') ? 'fr' : 'en';
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const spokenEndRef = useRef(0);
  const speakingRef = useRef(false);
  const streamDoneRef = useRef(false);
  const streamingTextRef = useRef('');

  const voiceInput = useVoiceInput(lang);
  const voiceOutput = useVoiceOutput(lang);

  // Load EVA status and conversations list
  const loadConversations = useCallback(async () => {
    try {
      const r = await api.getConversations({ limit: 30 });
      setConversations(r.conversations || []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    api.status().then((r) => setEvaEnabled(r.eva_enabled !== false)).catch(() => setEvaEnabled(false));
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load messages when switching conversation
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    api.getMessages(activeConvId)
      .then((r) => setMessages(r.messages || []))
      .catch(() => {});
  }, [activeConvId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const newConversation = async () => {
    try {
      const conv = await api.createConversation();
      setActiveConvId(conv.id);
      setMessages([]);
      await loadConversations();
      inputRef.current?.focus();
    } catch (e) {
      setError(e.message);
    }
  };

  const selectConversation = (id) => {
    setActiveConvId(id);
    setError(null);
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    try {
      await api.deleteConversation(id);
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
      }
      await loadConversations();
    } catch (_) {}
  };

  const trySpeakNext = useCallback((fullText, isDone) => {
    if (!autoPlayVoice || !voiceOutput.supported || speakingRef.current) return;
    const txt = fullText || streamingTextRef.current;
    const chunk = nextSentence(txt, spokenEndRef.current);
    if (chunk) {
      const from = txt.slice(spokenEndRef.current).indexOf(chunk) + spokenEndRef.current;
      if (from >= 0) spokenEndRef.current = from + chunk.length;
      speakingRef.current = true;
      voiceOutput.speak(chunk, () => {
        speakingRef.current = false;
        trySpeakNext(streamingTextRef.current, streamDoneRef.current);
      });
    } else if (isDone && spokenEndRef.current < txt.length) {
      const rest = txt.slice(spokenEndRef.current).trim();
      if (rest) {
        spokenEndRef.current = txt.length;
        speakingRef.current = true;
        voiceOutput.speak(rest, () => { speakingRef.current = false; });
      }
    }
  }, [autoPlayVoice, voiceOutput]);

  const send = useCallback(async (overrideText) => {
    const text = (overrideText ?? input).toString().trim();
    if (!text || loading) return;

    setInput('');
    setError(null);
    setStreamingContent('');
    spokenEndRef.current = 0;
    speakingRef.current = false;
    streamDoneRef.current = false;
    streamingTextRef.current = '';

    let convId = activeConvId;
    if (!convId) {
      try {
        const conv = await api.createConversation(text.slice(0, 80));
        convId = conv.id;
        setActiveConvId(convId);
      } catch (e) {
        setError('Failed to create conversation');
        return;
      }
    }

    setMessages((m) => [...m, { role: 'user', content: text, created_at: new Date().toISOString() }]);
    setLoading(true);

    let accumulated = '';
    try {
      let usedStream = false;
      try {
        for await (const event of api.chatStream(text, [], convId)) {
          usedStream = true;
          if (event.type === 'chunk' && event.text) {
            accumulated += event.text;
            streamingTextRef.current = accumulated;
            setStreamingContent(accumulated);
            trySpeakNext(accumulated, false);
          } else if (event.type === 'done') {
            const reply = event.reply || accumulated;
            streamingTextRef.current = reply;
            streamDoneRef.current = true;
            if (event.reset && event.conversation_id) {
              setActiveConvId(event.conversation_id);
              setMessages([]);
              loadConversations();
            } else {
              setMessages((m) => [...m, { role: 'assistant', content: reply, created_at: new Date().toISOString() }]);
              trySpeakNext(reply, true);
            }
            setStreamingContent('');
            loadConversations();
          } else if (event.type === 'error') {
            throw new Error(event.error || 'Stream error');
          }
        }
      } catch (streamErr) {
        if (usedStream) throw streamErr;
        const { reply, reset, conversation_id } = await api.chat(text, [], convId);
        streamingTextRef.current = reply || '';
        streamDoneRef.current = true;
        if (reset && conversation_id) {
          setActiveConvId(conversation_id);
          setMessages([]);
        } else {
          setMessages((m) => [...m, { role: 'assistant', content: reply, created_at: new Date().toISOString() }]);
          trySpeakNext(reply, true);
        }
        loadConversations();
      }
    } catch (e) {
      setError(e.body?.error || e.message || 'Error');
      setMessages((m) => m.slice(0, -1));
      setStreamingContent('');
    } finally {
      setLoading(false);
    }
  }, [input, loading, activeConvId, loadConversations, trySpeakNext]);

  // Hold to talk: appuyer = enregistrer, relâcher = envoyer
  const onVoicePressStart = useCallback(async () => {
    if (loading || !evaEnabled || !voiceInput.supported) return;
    setError(null);
    const ok = await voiceInput.testMicAccess();
    if (ok) {
      setInput('');
      voiceInput.startListening();
    }
  }, [loading, evaEnabled, voiceInput]);

  const onVoicePressEnd = useCallback(() => {
    if (!voiceInput.isListening) return;
    voiceInput.stopListening((transcript) => {
      const text = (transcript || '').trim();
      if (text) send(text);
      setInput('');
    });
  }, [voiceInput, send]);

  const sendFeedback = async (msgIndex, type) => {
    try {
      const msg = messages[msgIndex];
      await api.sendFeedback({
        feedback_type: type,
        original_text: msg.content.slice(0, 500),
      });
    } catch (_) {}
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-[calc(100vh-5rem)] gap-0 -m-6">
      {/* Sidebar — slide-over like ChatGPT */}
      {showSidebar && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowSidebar(false)} />
          <div className="fixed left-0 top-0 bottom-0 w-64 bg-eva-panel border-r border-slate-700/40 z-50 flex flex-col">
            <div className="p-3 border-b border-slate-700/40 flex items-center justify-between">
              <span className="text-sm font-medium text-white">{lang === 'fr' ? 'Conversations' : 'Conversations'}</span>
              <div className="flex gap-1">
                <button onClick={newConversation} className="px-2 py-1 rounded text-xs text-cyan-400 hover:bg-cyan-500/20" title="New chat">+</button>
                <button onClick={() => setShowSidebar(false)} className="px-2 py-1 rounded text-xs text-slate-400 hover:text-white">✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => { selectConversation(c.id); setShowSidebar(false); }}
                  className={`px-3 py-2.5 rounded-lg cursor-pointer flex items-center justify-between group ${
                    activeConvId === c.id ? 'bg-eva-accent/15 text-eva-accent' : 'text-slate-400 hover:bg-slate-700/40'
                  }`}
                >
                  <div className="min-w-0 flex-1 truncate text-sm">{c.title || 'New'}</div>
                  <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id, e); }} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 text-xs">×</button>
                </div>
              ))}
              {conversations.length === 0 && <div className="text-center text-eva-muted text-xs py-6">—</div>}
            </div>
          </div>
        </>
      )}

      {/* Main chat — ChatGPT-like centered layout */}
      <div className="flex-1 flex flex-col min-w-0 max-w-3xl mx-auto w-full">
        {!evaEnabled && (
          <div className="px-4 py-2 bg-amber-500/20 border-b border-amber-500/30 text-center">
            <p className="text-amber-200 text-sm">EVA is disabled.</p>
          </div>
        )}

        {/* Minimal header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/40 shrink-0">
          <button onClick={() => setShowSidebar(!showSidebar)} className="text-slate-400 hover:text-white p-2 -ml-2" title={lang === 'fr' ? 'Historique' : 'History'}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="text-sm font-medium text-white">EVA</span>
          <div className="flex items-center gap-1">
            <Link to="/chat/realtime" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 text-sm font-medium" title={lang === 'fr' ? 'Appeler EVA (voix temps réel)' : 'Voice call (Realtime)'}>
              🎤 {lang === 'fr' ? 'Appel vocal' : 'Voice call'}
            </Link>
            {voiceOutput.supported && (
              <button onClick={() => setAutoPlayVoice(!autoPlayVoice)} className={`p-2 rounded-lg ${autoPlayVoice ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-500 hover:text-slate-400'}`} title={autoPlayVoice ? (lang === 'fr' ? 'Réponse vocale activée' : 'Voice reply on') : (lang === 'fr' ? 'Réponse vocale désactivée' : 'Voice reply off')}>🔊</button>
            )}
          </div>
        </div>

        {/* Messages — centered, clean */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center pt-16">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/30 to-blue-600/30 flex items-center justify-center mb-4">
                  <span className="text-xl text-cyan-400">◈</span>
                </div>
                <p className="text-slate-400 text-sm mb-8">{lang === 'fr' ? 'Comment puis-je t\'aider ?' : 'How can I help?'}</p>
                <div className="flex flex-wrap gap-2 justify-center max-w-md">
                  {[lang === 'fr' ? 'Résume mes priorités' : 'Summarize my priorities', lang === 'fr' ? 'Rédige un email' : 'Draft an email', 'Draft a follow-up', lang === 'fr' ? 'Réponds à une demande de délai' : 'Payment extension reply'].slice(0, 4).map((q) => (
                    <button key={q} onClick={() => { setInput(q); inputRef.current?.focus(); }} className="px-3 py-2 rounded-lg bg-slate-800/60 text-slate-400 hover:bg-slate-700/60 hover:text-slate-300 text-sm">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">E</div>
                )}
                <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                  <div className={`rounded-2xl px-4 py-2.5 ${
                    msg.role === 'user' ? 'bg-slate-700/80 text-white rounded-tr-md' : 'bg-slate-800/60 text-slate-200 rounded-tl-md'
                  }`}>
                    <div className="eva-message whitespace-pre-wrap text-[15px] leading-relaxed">{msg.content}</div>
                  </div>
                  {msg.role === 'assistant' && (
                    <div className="flex gap-2 mt-1.5 opacity-60">
                      {voiceOutput.supported && <button onClick={() => voiceOutput.speak(msg.content)} className="text-[11px] hover:opacity-100">🔊</button>}
                      <button onClick={() => sendFeedback(i, 'thumbs_up')} className="text-[11px] hover:text-emerald-400">👍</button>
                      <button onClick={() => sendFeedback(i, 'thumbs_down')} className="text-[11px] hover:text-red-400">👎</button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {streamingContent && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">E</div>
                <div className="rounded-2xl rounded-tl-md px-4 py-2.5 bg-slate-800/60">
                  <div className="eva-message whitespace-pre-wrap text-[15px] leading-relaxed text-slate-200">{streamingContent}<span className="animate-pulse">▌</span></div>
                </div>
              </div>
            )}

            {loading && !streamingContent && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs shrink-0">E</div>
                <div className="flex gap-1 py-3">
                  <div className="w-2 h-2 rounded-full bg-slate-500 eva-dot" />
                  <div className="w-2 h-2 rounded-full bg-slate-500 eva-dot" />
                  <div className="w-2 h-2 rounded-full bg-slate-500 eva-dot" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {error && <div className="px-4 py-2 bg-red-500/10 text-red-400 text-sm text-center">{error}</div>}
        {voiceInput.error && <div className="px-4 py-2 bg-amber-500/10 text-amber-200 text-sm text-center">{voiceInput.error}</div>}

        {/* Input — hold mic to talk, release to send */}
        <div className="p-4 border-t border-slate-700/40 shrink-0">
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-2 items-end">
              {voiceInput.supported && (
                <button
                  type="button"
                  onPointerDown={onVoicePressStart}
                  onPointerUp={onVoicePressEnd}
                  onPointerLeave={onVoicePressEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={loading || !evaEnabled || voiceInput.isTranscribing}
                  className={`shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all select-none touch-none ${
                    voiceInput.isListening
                      ? 'bg-red-500/50 text-white scale-105 shadow-lg shadow-red-500/30'
                      : voiceInput.isTranscribing
                        ? 'bg-slate-700/60 text-slate-500'
                        : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 active:scale-95'
                  }`}
                  title={voiceInput.isListening ? (lang === 'fr' ? 'Relâcher pour envoyer' : 'Release to send') : (lang === 'fr' ? 'Maintenir pour parler' : 'Hold to speak')}
                >
                  🎤
                </button>
              )}
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={voiceInput.isListening ? voiceInput.interimTranscript : input}
                  onChange={(e) => !voiceInput.isListening && setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    voiceInput.isTranscribing
                      ? (lang === 'fr' ? 'Transcription…' : 'Transcribing…')
                      : voiceInput.isListening
                        ? (lang === 'fr' ? 'Parlez… relâchez pour envoyer' : 'Speak… release to send')
                        : (lang === 'fr' ? 'Message EVA…' : 'Message EVA…')
                  }
                  rows={1}
                  readOnly={voiceInput.isListening || voiceInput.isTranscribing}
                  className={`w-full min-h-[44px] max-h-32 py-3 px-4 pr-12 rounded-xl bg-slate-800 border text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none transition-colors ${
                    voiceInput.isListening ? 'border-red-500/50' : voiceInput.isTranscribing ? 'border-amber-500/30' : 'border-slate-600/50'
                  }`}
                  disabled={loading || !evaEnabled}
                />
                <button
                  onClick={send}
                  disabled={loading || !input.trim() || !evaEnabled || voiceInput.isListening || voiceInput.isTranscribing}
                  className="absolute right-2 bottom-2 p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
                  title={lang === 'fr' ? 'Envoyer' : 'Send'}
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
                </button>
              </div>
            </div>
            {(voiceInput.isListening || voiceInput.isTranscribing) && (
              <p className="mt-2 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                {voiceInput.isTranscribing ? (lang === 'fr' ? 'Transcription en cours…' : 'Transcribing…') : (lang === 'fr' ? 'Enregistrement… relâchez pour envoyer' : 'Recording… release to send')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
