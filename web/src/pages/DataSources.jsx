import { useEffect, useState } from 'react';
import { api } from '../api';

const SOURCE_TYPES = [
  { type: 'gmail', label: 'Gmail', desc: 'Connect via OAuth2 — EVA reads your recent emails and uses them as context.', color: 'bg-red-500/20 text-red-400', oauth: true },
  { type: 'whatsapp', label: 'WhatsApp', desc: 'Chat exports (coming soon)', color: 'bg-green-500/20 text-green-400' },
  { type: 'linkedin', label: 'LinkedIn', desc: 'Messages & connections (coming soon)', color: 'bg-indigo-500/20 text-indigo-400' },
  { type: 'drive', label: 'Google Drive', desc: 'Documents & contracts (coming soon)', color: 'bg-amber-500/20 text-amber-400' },
  { type: 'telegram', label: 'Telegram', desc: 'Message history (coming soon)', color: 'bg-blue-500/20 text-blue-400' },
  { type: 'documents', label: 'Manual Upload', desc: 'PDFs, contracts, reports', color: 'bg-purple-500/20 text-purple-400' },
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
      setConnectSuccess('Gmail connecté avec succès ! Synchronisation en cours...');
      window.history.replaceState({}, '', '/sources');
    }
    if (params.get('error')) {
      setError('Erreur OAuth: ' + params.get('error'));
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
      setError('Gmail OAuth non disponible: ' + (e.body?.error || e.message) + '. Vérifiez que EVA_GOOGLE_CLIENT_ID et EVA_GOOGLE_CLIENT_SECRET sont configurés sur Render (service EVA).');
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
    if (!confirm('Déconnecter ce compte Gmail ? Tous les emails synchronisés seront supprimés.')) return;
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
        <h1 className="text-2xl font-semibold text-white">Data Sources</h1>
        <p className="text-eva-muted text-sm mt-1">
          Memory Vault — connecte tes sources de données. EVA apprend de chaque source.
        </p>
      </div>

      {error && <div className="text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}
      {connectSuccess && (
        <div className="text-emerald-400 text-sm bg-emerald-500/10 rounded-lg px-4 py-2 flex items-center gap-2">
          <span>✓</span> {connectSuccess}
        </div>
      )}

      {/* Gmail accounts (connected) */}
      {hasGmail && (
        <div className="bg-eva-panel rounded-xl border border-emerald-500/30 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-700/40 flex items-center justify-between">
            <span className="text-sm font-medium text-white">Gmail Accounts</span>
            <span className="text-xs text-emerald-400">Connected</span>
          </div>
          <div className="divide-y divide-slate-700/30">
            {gmailAccounts.map((acct) => (
              <div key={acct.id} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium px-2 py-1 rounded bg-red-500/20 text-red-400">Gmail</span>
                    <div>
                      <span className="text-sm text-white">{acct.gmail_address}</span>
                      <span className={'ml-2 text-xs px-2 py-0.5 rounded-full ' + (
                        acct.sync_status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
                        acct.sync_status === 'syncing' ? 'bg-amber-500/20 text-amber-400' :
                        acct.sync_status === 'error' ? 'bg-red-500/20 text-red-400' :
                        'bg-slate-700 text-slate-400'
                      )}>{acct.sync_status}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => syncGmail(acct.id)}
                      disabled={syncing[acct.id]}
                      className="text-xs px-3 py-1.5 rounded bg-eva-accent/20 text-eva-accent hover:bg-eva-accent/30 disabled:opacity-50 transition-colors"
                    >
                      {syncing[acct.id] ? 'Syncing...' : 'Sync Now'}
                    </button>
                    <button
                      onClick={() => disconnectGmail(acct.id)}
                      className="text-xs px-3 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Déconnecter
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex gap-4 text-[10px] text-eva-muted">
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
        <h2 className="text-sm font-medium text-white mb-3">Sources Disponibles</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {SOURCE_TYPES.map((src) => {
            const connected = src.type === 'gmail' ? hasGmail : connectedTypes.includes(src.type);
            return (
              <div
                key={src.type}
                className={'bg-eva-panel rounded-xl border p-5 transition-all ' + (
                  connected ? 'border-emerald-500/30' : 'border-slate-700/40 hover:border-slate-600/60'
                )}
              >
                <div className="flex items-start justify-between">
                  <span className={'text-xs font-medium px-2 py-1 rounded ' + src.color}>{src.label}</span>
                  {connected && <span className="text-xs text-emerald-400">Connecté</span>}
                </div>
                <p className="text-xs text-eva-muted mt-3">{src.desc}</p>
                {!connected && (
                  <button
                    onClick={() => src.oauth ? connectGmail() : addSource(src.type)}
                    className={'mt-3 text-xs font-medium transition-colors ' + (
                      src.oauth
                        ? 'px-4 py-2 bg-eva-accent/20 text-eva-accent rounded-lg hover:bg-eva-accent/30'
                        : 'text-eva-accent hover:text-cyan-300'
                    )}
                  >
                    {src.oauth ? 'Connect Gmail →' : 'Register source →'}
                  </button>
                )}
                {connected && src.type === 'gmail' && (
                  <button
                    onClick={() => window.location.href = '/emails'}
                    className="mt-3 text-xs text-eva-accent hover:text-cyan-300 transition-colors"
                  >
                    Voir les emails →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pipeline info */}
      <div className="bg-slate-800/40 rounded-xl p-5 text-sm text-slate-400 max-w-2xl">
        <h3 className="text-slate-300 font-medium mb-2">Comment fonctionne le Memory Vault</h3>
        <p>
          Phase 2 : EVA se connecte directement à tes comptes (Gmail via OAuth2) et synchronise tes emails toutes les 30 minutes.
          Les emails sont indexés avec PostgreSQL full-text search. Quand tu poses une question à EVA sur un email ou un contact,
          elle cherche dans ta boîte mail et utilise le contexte pour répondre précisément.
        </p>
      </div>
    </div>
  );
}
