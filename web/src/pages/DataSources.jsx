import { useEffect, useState } from 'react';
import { api } from '../api';

const SOURCE_TYPES = [
  { type: 'gmail', label: 'Gmail', desc: 'Connect via OAuth2 — EVA reads your recent emails and uses them as context.', color: 'bg-red-500/20 text-red-600 dark:text-red-400', oauth: true },
  { type: 'calendar', label: 'Google Calendar', desc: 'Calendriers synchronisés via Gmail (1 par compte). Sync dans Calendar.', color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400', route: '/calendar', calendarFromGmail: true },
  { type: 'documents', label: 'Documents', desc: 'PDFs, contracts, reports — upload via the Documents page.', color: 'bg-purple-500/20 text-purple-600 dark:text-purple-400', route: '/documents', alwaysAvailable: true },
  { type: 'whatsapp', label: 'WhatsApp', desc: 'Chat exports (soon)', color: 'bg-green-500/20 text-green-600 dark:text-green-400', soon: true },
  { type: 'linkedin', label: 'LinkedIn', desc: 'Messages & connections (soon)', color: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400', soon: true },
  { type: 'drive', label: 'Google Drive', desc: 'Documents & contracts (soon)', color: 'bg-amber-500/20 text-amber-600 dark:text-amber-400', soon: true },
  { type: 'telegram', label: 'Telegram', desc: 'Message history (soon)', color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400', soon: true },
];

export default function DataSources() {
  const [sources, setSources] = useState([]);
  const [gmailAccounts, setGmailAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState({});
  const [connectSuccess, setConnectSuccess] = useState(null);

  useEffect(() => {
    loadData();
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'gmail') {
      setConnectSuccess('Gmail connected successfully. Syncing...');
      window.history.replaceState({}, '', '/sources');
    }
    if (params.get('error')) {
      setError('OAuth error: ' + params.get('error'));
      window.history.replaceState({}, '', '/sources');
    }
  }, []);

  const loadData = async () => {
    try {
      const [sourcesRes, gmailRes] = await Promise.all([
        api.getDataSources(),
        api.getGmailAccounts().catch(() => ({ accounts: [] })),
      ]);
      setSources(sourcesRes.sources || []);
      setGmailAccounts(gmailRes.accounts || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const connectGmail = async () => {
    try {
      setError(null);
      const { auth_url } = await api.getGmailAuthUrl();
      window.location.href = auth_url;
    } catch (e) {
      if (e.status === 401) {
        setError('Session expired. Please log in again, then try connecting Gmail.');
      } else {
        const isLocal = typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location?.hostname || '');
        const hint = isLocal
          ? ' Add EVA_GOOGLE_CLIENT_ID and EVA_GOOGLE_CLIENT_SECRET to eva/.env (see .env.example).'
          : ' Add them in Render → Environment.';
        setError((e.body?.error || e.message) + hint);
      }
    }
  };

  const syncGmail = async (accountId) => {
    setSyncing((prev) => ({ ...prev, [accountId]: true }));
    try {
      await api.syncGmail(accountId);
      await loadData();
    } catch (e) {
      setError('Sync failed: ' + e.message);
    } finally {
      setSyncing((prev) => ({ ...prev, [accountId]: false }));
    }
  };

  const disconnectGmail = async (accountId) => {
    if (!confirm('Disconnect this Gmail account? All synced emails will be removed.')) return;
    try {
      await api.disconnectGmail(accountId);
      await loadData();
    } catch (e) {
      setError(e.message);
    }
  };

  const addSource = async (type) => {
    try {
      await api.addDataSource({ source_type: type, config: {} });
      await loadData();
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
  const hasGmail = gmailAccounts.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Data Sources</h1>
        <p className="text-slate-600 dark:text-eva-muted text-sm mt-1">
          Memory Vault — connecte tes sources de données. EVA apprend de chaque source.
        </p>
      </div>

      {error && <div className="text-red-600 dark:text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}
      {connectSuccess && (
        <div className="text-emerald-600 dark:text-emerald-400 text-sm bg-emerald-500/10 rounded-lg px-4 py-2 flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2"><span>✓</span> {connectSuccess}</span>
          <a href="/calendar" className="text-cyan-600 dark:text-eva-accent hover:underline font-medium">→ Sync Calendar</a>
        </div>
      )}

      {/* Calendar scope hint */}
      {hasGmail && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <strong>Calendrier :</strong> Si Sync Calendar échoue avec « insufficient scopes », déconnectez puis reconnectez chaque compte Gmail ci-dessous pour accorder l&apos;accès au calendrier.
        </div>
      )}

      {/* invalid_grant / re-auth hint */}
      {hasGmail && gmailAccounts.some((a) => a.sync_status === 'error' && /expired|reconnect|invalid_grant/i.test(a.error_message || '')) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-800 dark:text-red-200">
          <strong>Réautorisation requise :</strong> Certains comptes ont expiré. Déconnectez-les puis reconnectez-les ci-dessous pour les réactiver.
        </div>
      )}

      {/* Gmail accounts (connected) */}
      {hasGmail && (
        <div className="bg-white dark:bg-eva-panel rounded-xl border border-emerald-500/30 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700/40 flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-white">Gmail Accounts</span>
            <a href="/calendar" className="text-xs px-3 py-1.5 rounded bg-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-500/30 transition-colors">📅 Calendar</a>
            <div className="flex items-center gap-2">
              <span className="text-xs text-emerald-600 dark:text-emerald-400">Connected</span>
              <button
                onClick={connectGmail}
                className="text-xs px-3 py-1.5 rounded bg-cyan-500/20 text-cyan-600 dark:text-eva-accent hover:bg-cyan-500/30 dark:hover:bg-eva-accent/30 transition-colors"
              >
                + Ajouter un compte Gmail
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-700/30">
            {gmailAccounts.map((acct) => (
              <div key={acct.id} className="px-4 sm:px-5 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-medium px-2 py-1 rounded bg-red-500/20 text-red-600 dark:text-red-400">Gmail</span>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-slate-900 dark:text-white block truncate">{acct.gmail_address}</span>
                      <span className={'ml-2 text-xs px-2 py-0.5 rounded-full ' + (
                        acct.sync_status === 'active' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                        acct.sync_status === 'syncing' ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' :
                        acct.sync_status === 'error' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                        'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      )}>{acct.sync_status}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => syncGmail(acct.id)}
                      disabled={syncing[acct.id]}
                      className="min-h-[44px] px-3 py-2 rounded text-sm bg-cyan-500/20 text-cyan-600 dark:text-eva-accent hover:bg-cyan-500/30 disabled:opacity-50 transition-colors touch-manipulation"
                    >
                      {syncing[acct.id] ? 'Syncing...' : 'Sync Now'}
                    </button>
                    <button
                      onClick={() => disconnectGmail(acct.id)}
                      className="min-h-[44px] px-3 py-2 rounded text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors touch-manipulation"
                    >
                      Déconnecter
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex gap-4 text-[10px] text-slate-500 dark:text-eva-muted">
                  <span>{acct.last_sync_at ? 'Dernière sync: ' + new Date(acct.last_sync_at).toLocaleString('fr-FR') : 'Pas encore synchronisé'}</span>
                  {acct.error_message && <span className="text-red-400">{acct.error_message}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available sources to connect */}
      <div>
        <h2 className="text-sm font-medium text-slate-900 dark:text-white mb-3">Sources Disponibles</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {SOURCE_TYPES.map((src) => {
            const connected = src.type === 'gmail' ? hasGmail
              : src.type === 'calendar' ? hasGmail
              : connectedTypes.includes(src.type);
            const showAction = src.alwaysAvailable || src.calendarFromGmail || (!connected && !src.soon);
            return (
              <div
                key={src.type}
                className={'bg-white dark:bg-eva-panel rounded-xl border p-5 transition-all ' + (
                  connected ? 'border-emerald-500/30' : 'border-slate-200 dark:border-slate-700/40 hover:border-slate-300 dark:hover:border-slate-600/60'
                ) + (src.soon ? ' opacity-80' : '')}
              >
                <div className="flex items-start justify-between">
                  <span className={'text-xs font-medium px-2 py-1 rounded ' + src.color}>{src.label}</span>
                  {connected && <span className="text-xs text-emerald-600 dark:text-emerald-400">Connecté</span>}
                  {src.alwaysAvailable && !connected && <span className="text-xs text-slate-500">Disponible</span>}
                  {src.soon && <span className="text-xs text-slate-500">soon</span>}
                </div>
                <p className="text-xs text-slate-600 dark:text-eva-muted mt-3">{src.desc}</p>
                {showAction && !src.soon && !connected && (
                  <button
                    onClick={() => src.oauth || src.calendarFromGmail ? connectGmail() : (src.route ? window.location.assign(src.route) : addSource(src.type))}
                    className={'mt-3 text-xs font-medium transition-colors ' + (
                      (src.oauth || src.calendarFromGmail)
                        ? 'px-4 py-2 bg-cyan-500/20 text-cyan-600 dark:text-eva-accent rounded-lg hover:bg-cyan-500/30 dark:hover:bg-eva-accent/30'
                        : 'text-cyan-600 dark:text-eva-accent hover:text-cyan-700 dark:hover:text-cyan-300'
                    )}
                  >
                    {src.oauth || src.calendarFromGmail ? 'Connect Gmail →' : src.route ? 'Go to Documents →' : 'Register source →'}
                  </button>
                )}
                {connected && src.type === 'gmail' && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    <a href="/emails" className="text-xs text-cyan-600 dark:text-eva-accent hover:underline">Voir les emails</a>
                    <button onClick={connectGmail} className="text-xs text-cyan-600 dark:text-eva-accent hover:text-cyan-700 dark:hover:text-cyan-300 transition-colors">+ Ajouter un compte</button>
                  </div>
                )}
                {connected && src.type === 'calendar' && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    <a href="/calendar" className="text-xs px-4 py-2 bg-cyan-500/20 text-cyan-600 dark:text-eva-accent rounded-lg hover:bg-cyan-500/30 dark:hover:bg-eva-accent/30 font-medium">Sync Calendar →</a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline info */}
      <div className="bg-slate-100 dark:bg-slate-800/40 rounded-xl p-5 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
        <h3 className="text-slate-700 dark:text-slate-300 font-medium mb-2">How the Memory Vault works</h3>
        <p>
          Phase 2: EVA connects directly to your accounts (Gmail via OAuth2) and syncs your emails every 30 minutes.
          Emails are indexed with PostgreSQL full-text search. When you ask EVA about an email or contact,
          it searches your inbox and uses context to respond accurately.
        </p>
      </div>
    </div>
  );
}
