import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function StatCard({ label, value, sub, color = 'text-white', link }) {
  const content = (
    <div className="bg-eva-panel rounded-xl border border-slate-700/40 p-5 hover:border-slate-600/60 transition-colors">
      <div className="text-eva-muted text-xs font-medium uppercase tracking-wider">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
      {sub && <div className="text-eva-muted text-xs mt-1">{sub}</div>}
    </div>
  );
  return link ? <Link to={link}>{content}</Link> : content;
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState({});
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getStats().catch(() => null),
      api.getSettings().catch(() => ({})),
      api.getAuditLogs({ limit: 8 }).catch(() => ({ logs: [] })),
    ])
      .then(([s, st, l]) => {
        setStats(s);
        setSettings(st);
        setLogs(l.logs || []);
      })
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

  if (error) return <div className="text-red-400 p-4">Error: {error}</div>;

  const killSwitchOn = settings.kill_switch?.enabled === true;
  const totalDrafts = stats ? Object.values(stats.drafts || {}).reduce((a, b) => a + b, 0) : 0;
  const pendingDrafts = stats?.drafts?.pending || 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
          <p className="text-eva-muted text-sm mt-1">EVA Command Center — status and recent activity</p>
        </div>
        <Link
          to="/chat"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium rounded-lg hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20"
        >
          <span>◈</span> Parler à EVA
        </Link>
      </div>

      {/* Status banner */}
      <div className={`rounded-xl p-4 border ${killSwitchOn ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${killSwitchOn ? 'bg-amber-400' : 'bg-emerald-400'} animate-pulse`} />
            <span className={`font-medium ${killSwitchOn ? 'text-amber-300' : 'text-emerald-300'}`}>
              {killSwitchOn ? 'Autonomous Mode: Paused' : 'EVA Active — Shadow Mode'}
            </span>
          </div>
          <Link to="/settings" className="text-sm text-slate-400 hover:text-white transition-colors">
            Settings →
          </Link>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Conversations" value={stats?.conversations ?? 0} link="/chat" color="text-cyan-400" />
        <StatCard label="Messages" value={stats?.messages ?? 0} sub="Total exchanged" color="text-blue-400" />
        <StatCard
          label="Drafts"
          value={totalDrafts}
          sub={pendingDrafts > 0 ? `${pendingDrafts} pending approval` : 'None pending'}
          link="/drafts"
          color={pendingDrafts > 0 ? 'text-amber-400' : 'text-white'}
        />
        <StatCard label="Documents" value={stats?.documents ?? 0} sub={formatBytes(stats?.documents_size)} link="/documents" color="text-purple-400" />
      </div>

      {/* Activity + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent activity */}
        <div className="lg:col-span-2 bg-eva-panel rounded-xl border border-slate-700/40 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/40 flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Recent Activity</h2>
            <Link to="/audit" className="text-xs text-eva-accent hover:underline">View all →</Link>
          </div>
          <div className="divide-y divide-slate-700/30">
            {logs.slice(0, 8).map((log) => (
              <div key={log.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    log.action_type === 'query' ? 'bg-cyan-400' :
                    log.action_type === 'file_uploaded' ? 'bg-purple-400' :
                    log.action_type === 'draft_created' ? 'bg-amber-400' :
                    'bg-slate-500'
                  }`} />
                  <span className="text-sm text-slate-300 truncate">{formatAction(log)}</span>
                </div>
                <span className="text-xs text-eva-muted shrink-0">{timeAgo(log.created_at)}</span>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="px-5 py-8 text-center text-eva-muted text-sm">
                No activity yet. Start by talking to EVA!
              </div>
            )}
          </div>
        </div>

        {/* Phase status */}
        <div className="bg-eva-panel rounded-xl border border-slate-700/40 p-5">
          <h2 className="text-sm font-medium text-white mb-4">EVA Phases</h2>
          <div className="space-y-4">
            {[
              { phase: 1, label: 'Memory Vault', desc: 'Archive & indexing', status: 'building', pct: 40 },
              { phase: 2, label: 'Voice + Shadow', desc: 'Real-time voice + observation', status: 'building', pct: 25 },
              { phase: 3, label: 'Limited Proxy', desc: 'Approve-before-send', status: 'planned', pct: 0 },
              { phase: 4, label: 'Fine-Tuned Model', desc: 'Your voice, your style', status: 'planned', pct: 0 },
              { phase: 5, label: 'Autonomous Proxy', desc: 'Full delegation', status: 'planned', pct: 0 },
            ].map((p) => (
              <div key={p.phase}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      p.status === 'building' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-700 text-slate-500'
                    }`}>P{p.phase}</span>
                    <span className="text-sm text-slate-300">{p.label}</span>
                  </div>
                  <span className="text-xs text-eva-muted">{p.pct}%</span>
                </div>
                <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      p.status === 'building' ? 'bg-gradient-to-r from-cyan-500 to-blue-500' : 'bg-slate-700'
                    }`}
                    style={{ width: `${p.pct}%` }}
                  />
                </div>
                <p className="text-[11px] text-eva-muted mt-0.5">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatAction(log) {
  const details = log.details || {};
  if (log.action_type === 'query') return `Chat: "${(details.message || '').slice(0, 60)}..."`;
  if (log.action_type === 'file_uploaded') return `Uploaded: ${details.filename || 'file'}`;
  if (log.action_type === 'draft_created') return `Draft: ${log.channel || 'email'}`;
  if (log.action_type === 'setting_changed') return `Setting changed: ${details.key || ''}`;
  return log.action_type + (log.channel ? ` (${log.channel})` : '');
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
