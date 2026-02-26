import { useEffect, useState } from 'react';
import EvaLoading from '../components/EvaLoading';
import { api } from '../api';

export default function Drafts() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  const load = () =>
    api.getDrafts({ limit: 50, ...(filter && { status: filter }) })
      .then((r) => setDrafts(r.drafts || []))
      .catch((e) => setError(e.message));

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

  const sendDraft = async (id) => {
    try {
      setError(null);
      await api.sendDraft(id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <EvaLoading />
      </div>
    );
  }

  const pending = drafts.filter((d) => d.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Drafts</h1>
          <p className="text-slate-600 dark:text-eva-muted text-sm mt-1">
            {pending > 0 ? `${pending} draft${pending > 1 ? 's' : ''} awaiting your approval` : 'Review and approve EVA\'s draft responses'}
          </p>
        </div>
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setLoading(true); }}
          className="bg-white dark:bg-eva-panel border border-slate-300 dark:border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-eva-accent/50"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="sent">Sent</option>
        </select>
      </div>

      {error && <div className="text-red-600 dark:text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}

      <div className="space-y-3">
        {drafts.map((d) => (
          <div key={d.id} className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-5 hover:border-slate-300 dark:hover:border-slate-600/60 transition-colors">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    d.channel === 'email' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                    d.channel === 'whatsapp' ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                    d.channel === 'linkedin' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' :
                    'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}>
                    {d.channel}
                  </span>
                  {d.confidence_score != null && (
                    <span className="text-xs text-slate-500 dark:text-eva-muted">{(d.confidence_score * 100).toFixed(0)}% confidence</span>
                  )}
                  <span className="text-xs text-slate-500 dark:text-eva-muted">{new Date(d.created_at).toLocaleString()}</span>
                </div>
                {d.subject_or_preview && <div className="font-medium text-slate-900 dark:text-white mb-1">{d.subject_or_preview}</div>}
                <p className="text-slate-600 dark:text-slate-300 text-sm whitespace-pre-wrap leading-relaxed">{d.body}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {d.status === 'pending' ? (
                  <>
                    <button
                      onClick={() => updateStatus(d.id, 'approved')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600/80 text-white text-sm hover:bg-emerald-500 transition-colors"
                    >Approve</button>
                    <button
                      onClick={() => updateStatus(d.id, 'rejected')}
                      className="px-3 py-1.5 rounded-lg bg-slate-600/80 text-white text-sm hover:bg-slate-500 transition-colors"
                    >Reject</button>
                  </>
                ) : d.status === 'approved' ? (
                  <button
                    onClick={() => sendDraft(d.id)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-500 transition-colors"
                  >Send via Gmail</button>
                ) : (
                  <span className={`text-xs px-2.5 py-1 rounded-full ${
                    d.status === 'sent' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                    d.status === 'approved' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                    d.status === 'rejected' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                    'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}>{d.status}</span>
                )}
              </div>
            </div>
          </div>
        ))}
        {drafts.length === 0 && (
          <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 p-12 text-center text-slate-600 dark:text-eva-muted">
            <p className="text-lg mb-1">No drafts{filter ? ` with status "${filter}"` : ''}</p>
            <p className="text-sm">When EVA drafts responses, they'll appear here for your review.</p>
          </div>
        )}
      </div>
    </div>
  );
}
