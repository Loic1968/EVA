import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Drafts() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  const load = () => api.getDrafts({ limit: 50, ...(filter && { status: filter }) }).then((r) => setDrafts(r.drafts || [])).catch((e) => setError(e.message));

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [filter]);

  const updateStatus = async (id, status) => {
    try {
      await api.updateDraft(id, { status });
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <div className="text-eva-muted">Loading...</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-white">Drafts</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-eva-panel border border-slate-600 rounded px-3 py-1.5 text-sm text-white"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="sent">Sent</option>
        </select>
      </div>
      <div className="bg-eva-panel rounded-lg border border-slate-700/50 overflow-hidden">
        <ul className="divide-y divide-slate-700/50">
          {drafts.map((d) => (
            <li key={d.id} className="p-4">
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm text-eva-muted">
                    <span>{d.channel}</span>
                    {d.thread_id && <span>· {d.thread_id}</span>}
                    {d.confidence_score != null && <span>· {(d.confidence_score * 100).toFixed(0)}% confidence</span>}
                  </div>
                  {d.subject_or_preview && <div className="font-medium text-white mt-1">{d.subject_or_preview}</div>}
                  <p className="text-slate-300 text-sm mt-1 whitespace-pre-wrap">{d.body}</p>
                  <div className="text-xs text-eva-muted mt-2">{new Date(d.created_at).toLocaleString()}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {d.status === 'pending' && (
                    <>
                      <button onClick={() => updateStatus(d.id, 'approved')} className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-500">Approve</button>
                      <button onClick={() => updateStatus(d.id, 'rejected')} className="px-3 py-1.5 rounded bg-slate-600 text-white text-sm hover:bg-slate-500">Reject</button>
                    </>
                  )}
                  <span className={`px-2 py-1 rounded text-xs ${d.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : d.status === 'sent' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-400'}`}>{d.status}</span>
                </div>
              </div>
            </li>
          ))}
          {drafts.length === 0 && <li className="p-8 text-center text-eva-muted">No drafts</li>}
        </ul>
      </div>
    </div>
  );
}
