import { useEffect, useState } from 'react';
import { api } from '../api';

export default function DataSources() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getDataSources()
      .then((r) => setSources(r.sources || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-eva-muted">Loading...</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Data sources</h1>
        <p className="text-eva-muted mt-1">Memory Vault ingestion status (Phase 1: Gmail, WhatsApp, Drive, etc.)</p>
      </div>
      <div className="bg-eva-panel rounded-lg border border-slate-700/50 p-6">
        {sources.length === 0 ? (
          <p className="text-eva-muted">No data sources connected yet. Run the EVA data pipeline (Python + LangChain) to ingest Gmail, WhatsApp, and documents into the vector DB.</p>
        ) : (
          <ul className="space-y-3">
            {sources.map((s) => (
              <li key={s.id} className="flex justify-between items-center py-2 border-b border-slate-700/30 last:border-0">
                <span className="text-white font-medium">{s.source_type}</span>
                <span className="text-eva-muted text-sm">{s.last_sync_at ? `Last sync: ${new Date(s.last_sync_at).toLocaleString()}` : 'Never synced'}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 p-4 bg-slate-800/50 rounded text-sm text-slate-400">
          <strong className="text-slate-300">Phase 1:</strong> Export data (Google Takeout, etc.) → run Python pipeline → embed with OpenAI → store in Qdrant on your VPS. This UI will list registered sources and last sync time once the pipeline is wired to the EVA API.
        </div>
      </div>
    </div>
  );
}
