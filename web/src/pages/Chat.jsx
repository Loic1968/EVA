import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';

export default function Chat() {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Load conversations list
  const loadConversations = useCallback(async () => {
    try {
      const r = await api.getConversations({ limit: 30 });
      setConversations(r.conversations || []);
    } catch (_) {}
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
  }, [messages]);

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

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError(null);

    // Auto-create conversation if none active
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

    try {
      const { reply } = await api.chat(text, [], convId);
      setMessages((m) => [...m, { role: 'assistant', content: reply, created_at: new Date().toISOString() }]);
      loadConversations();
    } catch (e) {
      setError(e.body?.error || e.message || 'Error');
      setMessages((m) => m.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const sendFeedback = async (msgIndex, type) => {
    try {
      const msg = messages[msgIndex];
      await api.sendFeedback({
        feedback_type: type,
        original_text: msg.content.slice(0, 500),
      });
    } catch (_) {}
  };

  return (
    <div className="flex h-[calc(100vh-5rem)] gap-0 -m-6">
      {/* Conversation sidebar */}
      {showSidebar && (
        <div className="w-64 bg-eva-panel border-r border-slate-700/40 flex flex-col shrink-0">
          <div className="p-3 border-b border-slate-700/40 flex items-center justify-between">
            <span className="text-sm font-medium text-white">Conversations</span>
            <button
              onClick={newConversation}
              className="w-7 h-7 rounded-lg bg-eva-accent/20 text-eva-accent hover:bg-eva-accent/30 flex items-center justify-center text-lg"
              title="New conversation"
            >+</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => selectConversation(c.id)}
                className={`group px-3 py-2.5 rounded-lg cursor-pointer flex items-center justify-between transition-colors ${
                  activeConvId === c.id ? 'bg-eva-accent/15 text-eva-accent' : 'text-slate-400 hover:bg-slate-700/40'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{c.title || 'New conversation'}</div>
                  <div className="text-[10px] text-eva-muted">{c.message_count || 0} messages</div>
                </div>
                <button
                  onClick={(e) => deleteConversation(c.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 text-xs ml-2 shrink-0"
                  title="Delete"
                >x</button>
              </div>
            ))}
            {conversations.length === 0 && (
              <div className="text-center text-eva-muted text-xs py-6">No conversations yet</div>
            )}
          </div>
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-700/40 flex items-center gap-3 bg-eva-panel/50">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="text-eva-muted hover:text-white text-sm"
          >
            {showSidebar ? '◀' : '▶'}
          </button>
          <div>
            <h1 className="text-base font-medium text-white">Parler à EVA</h1>
            <p className="text-[11px] text-eva-muted">
              {activeConvId
                ? conversations.find((c) => c.id === activeConvId)?.title || 'Active conversation'
                : 'Start a new conversation'}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400/20 to-blue-600/20 flex items-center justify-center mb-4">
                <span className="text-2xl">◈</span>
              </div>
              <h2 className="text-lg font-medium text-white mb-2">Bonjour Loic</h2>
              <p className="text-eva-muted text-sm max-w-md mb-6">
                Je suis EVA, ton double IA. Pose une question, donne une instruction, ou demande-moi de rédiger quelque chose.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-lg">
                {[
                  'Résume-moi les priorités de la semaine',
                  'Rédige un email de relance client',
                  'How should I respond to a payment extension request?',
                  'Draft a follow-up for the Singapore deal',
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="text-left px-4 py-3 rounded-lg border border-slate-700/40 text-sm text-slate-400 hover:border-eva-accent/40 hover:text-slate-300 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${msg.role === 'user' ? '' : 'flex gap-3'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-1">E</div>
                )}
                <div>
                  <div className={`rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-eva-accent/20 text-white rounded-tr-md'
                      : 'bg-slate-800/80 text-slate-200 rounded-tl-md'
                  }`}>
                    <div className="eva-message whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
                  </div>
                  {msg.role === 'assistant' && (
                    <div className="flex gap-1 mt-1 ml-1">
                      <button onClick={() => sendFeedback(i, 'thumbs_up')} className="text-slate-600 hover:text-emerald-400 text-xs p-1" title="Good response">+1</button>
                      <button onClick={() => sendFeedback(i, 'thumbs_down')} className="text-slate-600 hover:text-red-400 text-xs p-1" title="Bad response">-1</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">E</div>
                <div className="bg-slate-800/80 rounded-2xl rounded-tl-md px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-slate-500 eva-dot" />
                    <div className="w-2 h-2 rounded-full bg-slate-500 eva-dot" />
                    <div className="w-2 h-2 rounded-full bg-slate-500 eva-dot" />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="px-5 py-2 bg-red-500/10 border-t border-red-500/20">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-slate-700/40 bg-eva-panel/50">
          <div className="flex gap-3 max-w-4xl mx-auto">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Message EVA..."
              className="flex-1 bg-slate-800 border border-slate-600/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-eva-accent/50 focus:border-eva-accent/50 transition-all"
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="px-5 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium rounded-xl hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/10"
            >
              Envoyer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
