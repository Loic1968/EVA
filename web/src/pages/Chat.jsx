import { useState, useRef, useEffect } from 'react';
import { api } from '../api';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const history = messages.slice(-20).map(({ role, content }) => ({ role, content }));
      const { reply } = await api.chat(text, history);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e.message || 'Erreur');
      setMessages((m) => m.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-white">Parler à EVA</h1>
        <p className="text-eva-muted text-sm mt-1">EVA est ton double IA. Pose une question ou donne une instruction (texte). La voix viendra plus tard.</p>
      </div>

      <div className="flex-1 bg-eva-panel rounded-lg border border-slate-700/50 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-eva-muted py-8">
              <p>Démarre la conversation. Exemples :</p>
              <ul className="mt-3 text-sm space-y-1 text-slate-400">
                <li>« Résume-moi les priorités de la semaine »</li>
                <li>« Comment je réponds d’habitude à une demande de délai de paiement ? »</li>
                <li>« Rédige un court email de relance pour le client X »</li>
              </ul>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-eva-accent/20 text-white'
                    : 'bg-slate-700/50 text-slate-200'
                }`}
              >
                <div className="text-xs text-eva-muted mb-1">{msg.role === 'user' ? 'Toi' : 'EVA'}</div>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-slate-700/50 rounded-lg px-4 py-2 text-slate-400">EVA réfléchit…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <div className="px-4 py-2 text-red-400 text-sm">{error}</div>}

        <div className="p-4 border-t border-slate-700/50 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Écris ton message…"
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-eva-accent"
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 bg-eva-accent text-eva-dark font-medium rounded-lg hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
