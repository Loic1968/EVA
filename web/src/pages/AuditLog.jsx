import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getAuditLogs({ limit: 100 })
      .then((r) => setLogs(r.logs || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-eva-muted">Loading...</div>;
  if (error) return <div className="text-red-400">Error: {error}</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Audit log</h1>
      <div className="bg-eva-panel rounded-lg border border-slate-700/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 text-left text-eva-muted">
              <th className="p-3">Time</th>
              <th className="p-3">Action</th>
              <th className="p-3">Channel</th>
              <th className="p-3">Confidence</th>
              <th className="p-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-slate-700/30">
                <td className="p-3 text-slate-400">{new Date(log.created_at).toLocaleString()}</td>
                <td className="p-3 text-white">{log.action_type}</td>
                <td className="p-3 text-slate-300">{log.channel || '—'}</td>
                <td className="p-3">{log.confidence_score != null ? `${(log.confidence_score * 100).toFixed(0)}%` : '—'}</td>
                <td className="p-3 text-slate-400 max-w-xs truncate">{Object.keys(log.details || {}).length ? JSON.stringify(log.details) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && <div className="p-8 text-center text-eva-muted">No audit logs yet</div>}
      </div>
    </div>
  );
}
