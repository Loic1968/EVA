import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard() {
  const [drafts, setDrafts] = useState({ drafts: [] });
  const [logs, setLogs] = useState({ logs: [] });
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getDrafts({ limit: 5 }).catch(() => ({ drafts: [] })),
      api.getAuditLogs({ limit: 5 }).catch(() => ({ logs: [] })),
      api.getSettings().catch(() => ({})),
    ])
      .then(([d, l, s]) => {
        setDrafts(d);
        setLogs(l);
        setSettings(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-eva-muted">Loading...</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;

  const killSwitchOn = settings.kill_switch?.enabled === true;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
        <p className="text-eva-muted mt-1">EVA status and recent activity</p>
        <Link to="/chat" className="inline-block mt-3 px-4 py-2 bg-eva-accent text-eva-dark font-medium rounded-lg hover:bg-cyan-400">
          Parler à EVA →
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-eva-panel rounded-lg border border-slate-700/50 p-4">
          <div className="text-eva-muted text-sm">Autonomous mode</div>
          <div className="mt-1 text-xl font-medium text-white">
            {killSwitchOn ? <span className="text-amber-400">Paused</span> : <span className="text-emerald-400">Active</span>}
          </div>
          <Link to="/settings" className="text-sm text-eva-accent hover:underline mt-2 inline-block">Settings →</Link>
        </div>
        <div className="bg-eva-panel rounded-lg border border-slate-700/50 p-4">
          <div className="text-eva-muted text-sm">Pending drafts</div>
          <div className="mt-1 text-xl font-medium text-white">{drafts.drafts?.length ?? 0}</div>
          <Link to="/drafts" className="text-sm text-eva-accent hover:underline mt-2 inline-block">View drafts →</Link>
        </div>
        <div className="bg-eva-panel rounded-lg border border-slate-700/50 p-4">
          <div className="text-eva-muted text-sm">Recent actions</div>
          <div className="mt-1 text-xl font-medium text-white">{logs.logs?.length ?? 0}</div>
          <Link to="/audit" className="text-sm text-eva-accent hover:underline mt-2 inline-block">Audit log →</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-eva-panel rounded-lg border border-slate-700/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50 font-medium text-white">Recent drafts</div>
          <ul className="divide-y divide-slate-700/50">
            {(drafts.drafts || []).slice(0, 5).map((d) => (
              <li key={d.id} className="px-4 py-3 flex justify-between items-start">
                <div className="min-w-0 flex-1">
                  <span className="text-slate-300 text-sm">{d.channel}</span>
                  <p className="text-white truncate mt-0.5">{d.subject_or_preview || d.body?.slice(0, 60)}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${d.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-600 text-slate-400'}`}>{d.status}</span>
              </li>
            ))}
            {(!drafts.drafts || drafts.drafts.length === 0) && (
              <li className="px-4 py-6 text-center text-eva-muted text-sm">No drafts yet</li>
            )}
          </ul>
        </div>
        <div className="bg-eva-panel rounded-lg border border-slate-700/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700/50 font-medium text-white">Recent audit log</div>
          <ul className="divide-y divide-slate-700/50">
            {(logs.logs || []).slice(0, 5).map((log) => (
              <li key={log.id} className="px-4 py-2 flex justify-between items-center text-sm">
                <span className="text-slate-300">{log.action_type}</span>
                <span className="text-eva-muted">{new Date(log.created_at).toLocaleString()}</span>
              </li>
            ))}
            {(!logs.logs || logs.logs.length === 0) && (
              <li className="px-4 py-6 text-center text-eva-muted text-sm">No logs yet</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
