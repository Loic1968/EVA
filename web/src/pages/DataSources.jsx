import { useEffect, useState } from 'react';
import { api } from '../api';

const SOURCE_TYPES = [
  { type: 'gmail', label: 'Gmail', desc: 'Email archives via Google Takeout', color: 'bg-red-500/20 text-red-400' },
  { type: 'whatsapp', label: 'WhatsApp', desc: 'Chat exports', color: 'bg-green-500/20 text-green-400' },
  { type: 'linkedin', label: 'LinkedIn', desc: 'Messages & connections', color: 'bg-indigo-500/20 text-indigo-400' },
  { type: 'drive', label: 'Google Drive', desc: 'Documents & contracts', color: 'bg-amber-500/20 text-amber-400' },
  { type: 'telegram', label: 'Telegram', desc: 'Message history', color: 'bg-blue-500/20 text-blue-400' },
  { type: 'documents', label: 'Manual Upload', desc: 'PDFs, contracts, reports', color: 'bg-purple-500/20 text-purple-400' },
];

export default function DataSources() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getDataSources()
      .then((r) => setSources(r.sources || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const addSource = async (type) => {
    try {
      await api.addDataSource({ source_type: type, config: {} });
      const r = await api.getDataSources();
      setSources(r.sources || []);
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex gap-1">
          <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
          <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
          <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
        </div>
      </div>
    );
  }

  const connectedTypes = sources.map((s) => s.source_type);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Data Sources</h1>
        <p className="text-eva-muted text-sm mt-1">
          Memory Vault ingestion — connect your digital life. EVA learns from every source you add.
        </p>
      </div>

      {error && <div className="text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}

      {/* Connected sources */}
      {sources.length > 0 && (
        <div className="bg-eva-panel rounded-xl border border-slate-700/40 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-700/40">
            <span className="text-sm font-medium text-white">Connected Sources ({sources.length})</span>
          </div>
          <div className="divide-y divide-slate-700/30">
            {sources.map((s) => {
              const meta = SOURCE_TYPES.find((t) => t.type === s.source_type) || {};
              return (
                <div key={s.id} className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${meta.color || 'bg-slate-700 text-slate-400'}`}>
                      {meta.label || s.source_type}
                    </span>
                    <div>
                      <span className="text-sm text-white">{s.external_id || meta.label || s.source_type}</span>
                      {s.record_count > 0 && <span className="text-xs text-eva-muted ml-2">{s.record_count.toLocaleString()} records</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'
                    }`}>{s.status}</span>
                    <div className="text-[10px] text-eva-muted mt-1">
                      {s.last_sync_at ? `Synced: ${new Date(s.last_sync_at).toLocaleString()}` : 'Not synced yet'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Available sources to connect */}
      <div>
        <h2 className="text-sm font-medium text-white mb-3">Available Sources</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {SOURCE_TYPES.map((src) => {
            const connected = connectedTypes.includes(src.type);
            return (
              <div
                key={src.type}
                className={`bg-eva-panel rounded-xl border p-5 transition-all ${
                  connected ? 'border-emerald-500/30' : 'border-slate-700/40 hover:border-slate-600/60'
                }`}
              >
                <div className="flex items-start justify-between">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${src.color}`}>{src.label}</span>
                  {connected && <span className="text-xs text-emerald-400">Connected</span>}
                </div>
                <p className="text-xs text-eva-muted mt-3">{src.desc}</p>
                {!connected && (
                  <button
                    onClick={() => addSource(src.type)}
                    className="mt-3 text-xs text-eva-accent hover:text-cyan-300 transition-colors"
                  >
                    Register source →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline info */}
      <div className="bg-slate-800/40 rounded-xl p-5 text-sm text-slate-400 max-w-2xl">
        <h3 className="text-slate-300 font-medium mb-2">How the Memory Vault works</h3>
        <p>
          Phase 1: Export your data (Google Takeout, WhatsApp export, etc.) and upload it to EVA.
          The Python pipeline processes your archives, chunks text, generates embeddings with OpenAI,
          and stores them in Qdrant (vector database) on your private VPS. EVA then uses RAG to search
          your 20+ years of history in real time when answering questions.
        </p>
      </div>
    </div>
  );
}
