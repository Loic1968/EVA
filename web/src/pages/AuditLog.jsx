import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getAuditLogs({ limit: 200 })
      .then((r) => setLogs(r.logs || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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

  if (error) return <div className="text-red-600 dark:text-red-400 p-4">Error: {error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Audit Log</h1>
        <p className="text-slate-600 dark:text-eva-muted text-sm mt-1">Every action EVA takes is logged with full explainability. {logs.length} entries.</p>
      </div>

      <div className="bg-white dark:bg-eva-panel rounded-xl border border-slate-200 dark:border-slate-700/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700/40 text-left">
                <th className="px-5 py-3 text-slate-500 dark:text-eva-muted font-medium text-xs uppercase tracking-wider">Time</th>
                <th className="px-5 py-3 text-slate-500 dark:text-eva-muted font-medium text-xs uppercase tracking-wider">Action</th>
                <th className="px-5 py-3 text-slate-500 dark:text-eva-muted font-medium text-xs uppercase tracking-wider">Channel</th>
                <th className="px-5 py-3 text-slate-500 dark:text-eva-muted font-medium text-xs uppercase tracking-wider">Confidence</th>
                <th className="px-5 py-3 text-slate-500 dark:text-eva-muted font-medium text-xs uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 dark:border-slate-700/20 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      log.action_type === 'query' ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400' :
                      log.action_type === 'file_uploaded' ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' :
                      log.action_type === 'draft_created' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' :
                      log.action_type === 'setting_changed' ? 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300' :
                      'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                    }`}>{log.action_type}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-700 dark:text-slate-300">{log.channel || '—'}</td>
                  <td className="px-5 py-3">
                    {log.confidence_score != null ? (
                      <span className={`text-xs font-medium ${
                        log.confidence_score >= 0.8 ? 'text-emerald-600 dark:text-emerald-400' :
                        log.confidence_score >= 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
                      }`}>{(log.confidence_score * 100).toFixed(0)}%</span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-400 max-w-xs">
                    <span className="truncate block text-xs">
                      {formatDetails(log.details)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {logs.length === 0 && (
          <div className="p-12 text-center text-slate-600 dark:text-eva-muted">No audit logs yet. Every EVA action will be recorded here.</div>
        )}
      </div>
    </div>
  );
}

function formatDetails(details) {
  if (!details || Object.keys(details).length === 0) return '—';
  if (details.message) return `"${details.message.slice(0, 80)}"`;
  if (details.filename) return details.filename;
  return JSON.stringify(details).slice(0, 100);
}
