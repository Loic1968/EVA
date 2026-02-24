import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Emails() {
  const [emails, setEmails] = useState([]);
  const [gmailAccounts, setGmailAccounts] = useState([]);
  const [activeTab, setActiveTab] = useState('all');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  const fetchAccounts = async () => {
    try {
      const res = await api.getGmailAccounts().catch(() => ({ accounts: [] }));
      setGmailAccounts(res.accounts || []);
    } catch (_) {}
  };

  const fetchEmails = async (searchQuery = '', pageNum = 0, accountId = null) => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: PAGE_SIZE, offset: pageNum * PAGE_SIZE };
      if (accountId && accountId !== 'all') params.gmail_account_id = accountId;

      let result;
      if (searchQuery.trim()) {
        result = await api.searchEmails(searchQuery, PAGE_SIZE, accountId && accountId !== 'all' ? accountId : undefined);
      } else {
        result = await api.getEmails(params);
      }
      setEmails(result.emails || []);
      setTotal(result.total || (result.emails?.length ?? 0));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAccounts(); }, []);
  useEffect(() => {
    fetchEmails(search, page, activeTab);
  }, [activeTab, page]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(0);
    fetchEmails(search, 0, activeTab);
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchEmails(search, newPage, activeTab);
  };

  const openEmail = async (email) => {
    setDetailLoading(true);
    setSelectedEmail(null);
    try {
      const detail = await api.getEmail(email.id);
      setSelectedEmail(detail);
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const formatDate = (d) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now - date;
    if (diff < 86400000) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  const formatGroupDate = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const diff = now - d;
    const weekAgo = 7 * 86400000;
    if (dateStr === today) return 'Aujourd\'hui';
    if (dateStr === yesterdayStr) return 'Hier';
    if (diff < weekAgo) return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const emailsByDate = emails.reduce((acc, email) => {
    const dateStr = new Date(email.received_at).toISOString().slice(0, 10);
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push(email);
    return acc;
  }, {});
  const dateKeys = Object.keys(emailsByDate).sort((a, b) => b.localeCompare(a));

  const formatAttachmentSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  const formatSyncTime = (d) => {
    if (!d) return null;
    const date = new Date(d);
    return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatRelativeTime = (d) => {
    if (!d) return null;
    const diff = (Date.now() - new Date(d)) / 1000;
    if (diff < 60) return 'à l\'instant';
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
    return formatSyncTime(d);
  };

  const activeAccount = activeTab === 'all' ? null : gmailAccounts.find((a) => String(a.id) === activeTab);
  const lastSyncAt = activeTab === 'all'
    ? gmailAccounts.reduce((latest, a) => {
        if (!a.last_sync_at) return latest;
        return !latest || new Date(a.last_sync_at) > new Date(latest) ? a.last_sync_at : latest;
      }, null)
    : activeAccount?.last_sync_at;
  const syncStatus = activeAccount?.sync_status;
  const syncLabel = syncStatus === 'active' ? 'Synchronisé' : syncStatus === 'syncing' ? 'Synchronisation…' : syncStatus === 'error' ? 'Erreur' : syncStatus === 'pending' ? 'En attente' : null;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex-shrink-0 mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Boîte mail</h1>
          <p className="text-eva-muted text-sm mt-1">
            {total > 0 ? `${total.toLocaleString()} emails` : 'Connecte Gmail depuis Data Sources.'}
          </p>
          {gmailAccounts.length > 0 && (
            <div className="flex items-center gap-3 mt-1.5 text-xs">
              {syncLabel && (
                <span className={`px-2 py-0.5 rounded font-medium ${
                  syncStatus === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
                  syncStatus === 'syncing' ? 'bg-amber-500/20 text-amber-400' :
                  syncStatus === 'error' ? 'bg-red-500/20 text-red-400' :
                  'bg-slate-700/60 text-slate-400'
                }`}>
                  {syncLabel}
                </span>
              )}
              {lastSyncAt ? (
                <span className="text-eva-muted" title={formatSyncTime(lastSyncAt)}>
                  Dernière sync: {formatRelativeTime(lastSyncAt)}
                </span>
              ) : activeTab !== 'all' && (
                <span className="text-eva-muted">Pas encore synchronisé</span>
              )}
            </div>
          )}
        </div>
        <a
          href="https://mail.google.com/mail/?view=cm"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 px-4 py-2.5 bg-eva-accent text-slate-900 rounded-lg text-sm font-medium hover:bg-cyan-400 transition-colors flex items-center gap-2"
        >
          <span>✏️</span> Nouvel email
        </a>
      </div>

      {error && <div className="text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2 mb-4">{error}</div>}

      {/* Tabs par boîte mail */}
      <div className="flex flex-wrap gap-1 mb-4">
        <button
          onClick={() => { setActiveTab('all'); setPage(0); setSelectedEmail(null); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'all' ? 'bg-eva-accent/20 text-eva-accent' : 'bg-eva-panel border border-slate-700/40 text-slate-400 hover:text-white'}`}
        >
          ✉ Tous
        </button>
        {gmailAccounts.map((acct) => (
          <button
            key={acct.id}
            onClick={() => { setActiveTab(String(acct.id)); setPage(0); setSelectedEmail(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium truncate max-w-[180px] ${activeTab === String(acct.id) ? 'bg-eva-accent/20 text-eva-accent' : 'bg-eva-panel border border-slate-700/40 text-slate-400 hover:text-white'}`}
            title={acct.gmail_address}
          >
            📧 {acct.gmail_address}
          </button>
        ))}
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-4 flex-shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher dans les emails..."
          className="flex-1 px-4 py-2.5 bg-eva-panel border border-slate-700/40 rounded-lg text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-eva-accent/50"
        />
        <button
          type="submit"
          className="px-5 py-2.5 bg-eva-accent/20 text-eva-accent rounded-lg text-sm font-medium hover:bg-eva-accent/30 transition-colors"
        >
          Rechercher
        </button>
      </form>

      {/* Split: liste | détail */}
      <div className="flex-1 flex gap-4 min-h-0">
        <div className={`bg-eva-panel rounded-xl border border-slate-700/40 overflow-hidden flex flex-col ${selectedEmail ? 'w-[380px] flex-shrink-0' : 'flex-1'}`}>
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
            <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
            <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
          </div>
        </div>
      ) : emails.length === 0 ? (
        <div className="p-8 text-center flex-1">
          <p className="text-eva-muted text-sm">
            {search ? 'Aucun email trouvé.' : 'Aucun email. Connecte Gmail depuis Data Sources.'}
          </p>
        </div>
      ) : (
            <>
          <div className="overflow-y-auto flex-1">
            {dateKeys.map((dateStr) => (
              <div key={dateStr} className="border-b border-slate-700/30 last:border-b-0">
                <div className="px-4 py-2 bg-slate-800/50 sticky top-0 z-10 text-xs font-medium text-eva-muted uppercase tracking-wider">
                  {formatGroupDate(dateStr)}
                </div>
                <div className="divide-y divide-slate-700/20">
                  {emailsByDate[dateStr].map((email) => (
                    <button
                      key={email.id}
                      onClick={() => openEmail(email)}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-700/20 flex items-start gap-3 ${
                        selectedEmail?.id === email.id ? 'bg-slate-700/30 border-l-2 border-eva-accent' : ''
                      } ${!email.is_read ? 'bg-slate-700/10' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-sm truncate ${!email.is_read ? 'text-white font-medium' : 'text-slate-300'}`}>
                            {email.from_name || email.from_email}
                          </span>
                          {email.is_starred && <span className="text-amber-400 text-xs">★</span>}
                          {email.has_attachments && <span className="text-slate-500 text-xs">📎</span>}
                        </div>
                        <div className={`text-sm truncate ${!email.is_read ? 'text-slate-200' : 'text-slate-400'}`}>
                          {email.subject || '(sans objet)'}
                        </div>
                        <div className="text-xs text-eva-muted truncate mt-0.5">
                          {email.snippet}
                        </div>
                      </div>
                      <span className="text-xs text-eva-muted whitespace-nowrap shrink-0" title={new Date(email.received_at).toLocaleString('fr-FR')}>
                        {formatDate(email.received_at)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {total > PAGE_SIZE && (
            <div className="px-4 py-2 border-t border-slate-700/40 flex items-center justify-between flex-shrink-0">
              <span className="text-xs text-eva-muted">
                Page {page + 1} / {Math.ceil(total / PAGE_SIZE)}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 0}
                  className="text-xs px-3 py-1 rounded bg-slate-700/40 text-slate-400 hover:text-white disabled:opacity-30"
                >
                  ← Précédent
                </button>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  className="text-xs px-3 py-1 rounded bg-slate-700/40 text-slate-400 hover:text-white disabled:opacity-30"
                >
                  Suivant →
                </button>
              </div>
            </div>
          )}
            </>
        )}
        </div>

        {/* Panneau détail */}
        <div className={`flex-1 bg-eva-panel rounded-xl border border-slate-700/40 overflow-hidden flex flex-col min-w-0 ${!selectedEmail ? 'hidden' : ''}`}>
          {detailLoading ? (
            <div className="flex justify-center items-center flex-1">
              <div className="flex gap-1"><div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" /><div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" /><div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" /></div>
            </div>
          ) : selectedEmail ? (
            <>
              <div className="p-4 border-b border-slate-700/40 flex-shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-medium text-white truncate">{selectedEmail.subject || '(sans objet)'}</h2>
                    <p className="text-sm text-eva-muted mt-0.5">De: <span className="text-slate-300">{selectedEmail.from_name ? `${selectedEmail.from_name} <${selectedEmail.from_email}>` : selectedEmail.from_email}</span></p>
                    {selectedEmail.to_emails?.length > 0 && <p className="text-sm text-eva-muted">À: <span className="text-slate-400">{Array.isArray(selectedEmail.to_emails) ? selectedEmail.to_emails.join(', ') : selectedEmail.to_emails}</span></p>}
                    {selectedEmail.cc_emails?.length > 0 && <p className="text-sm text-eva-muted">Cc: <span className="text-slate-400">{Array.isArray(selectedEmail.cc_emails) ? selectedEmail.cc_emails.join(', ') : selectedEmail.cc_emails}</span></p>}
                  </div>
                  <span className="text-xs text-eva-muted whitespace-nowrap">{new Date(selectedEmail.received_at).toLocaleString('fr-FR')}</span>
                </div>
                {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700/30">
                    <div className="text-xs text-eva-muted mb-1">Pièces jointes :</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedEmail.attachments.map((att, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 bg-slate-700/40 rounded-lg text-sm text-slate-300">
                          <span>📎</span>
                          <span className="truncate max-w-[200px]" title={att.filename}>{att.filename}</span>
                          {att.size_bytes && <span className="text-xs text-eva-muted">({att.size_bytes < 1024 ? att.size_bytes + ' o' : (att.size_bytes / 1024).toFixed(0) + ' Ko'})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans">
                  {selectedEmail.body_plain || (selectedEmail.body_html ? selectedEmail.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '') || '(contenu vide)'}
                </pre>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
