import { useEffect, useState } from 'react';
import { api } from '../api';

const FOLDERS = [
  { id: 'inbox', label: 'Boîte de réception', icon: '📥' },
  { id: 'sent', label: 'Envoyés', icon: '📤' },
  { id: 'draft', label: 'Brouillons', icon: '✏️' },
  { id: 'all', label: 'Tous les éléments', icon: '📧' },
];

export default function Emails() {
  const [emails, setEmails] = useState([]);
  const [gmailAccounts, setGmailAccounts] = useState([]);
  const [folder, setFolder] = useState('inbox');
  const [activeTab, setActiveTab] = useState('all');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [foldersOpen, setFoldersOpen] = useState(false);
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
      const params = { limit: PAGE_SIZE, offset: pageNum * PAGE_SIZE, folder };
      if (accountId && accountId !== 'all') params.gmail_account_id = accountId;

      let result;
      if (searchQuery.trim()) {
        result = await api.searchEmails(searchQuery, PAGE_SIZE, accountId && accountId !== 'all' ? accountId : undefined, folder);
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
  }, [activeTab, page, folder]);

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

  /** Outlook-style section labels: Today, Yesterday, This Week, Last Week, Last Month, Older */
  const getDateSection = (d) => {
    const date = new Date(d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today - dDate) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays <= 7) return 'This Week';
    if (diffDays <= 14) return 'Last Week';
    if (diffDays <= 31) return 'Last Month';
    return 'Older';
  };

  /** Outlook-style: time for Today, Yesterday + time, or date for older */
  const formatDate = (d) => {
    const date = new Date(d);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    if (isYesterday) return `Yesterday ${time}`;
    if (date.getFullYear() !== today.getFullYear()) {
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const SECTION_ORDER = ['Today', 'Yesterday', 'This Week', 'Last Week', 'Last Month', 'Older'];
  const groupEmailsBySection = (list) => {
    const groups = {};
    SECTION_ORDER.forEach((s) => { groups[s] = []; });
    (list || []).forEach((email) => {
      const section = getDateSection(email.received_at);
      if (groups[section]) groups[section].push(email);
      else groups.Older.push(email);
    });
    return groups;
  };

  const formatSyncTime = (d) => {
    if (!d) return null;
    return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatRelativeTime = (d) => {
    if (!d) return null;
    const diff = (Date.now() - new Date(d)) / 1000;
    if (diff < 60) return "à l'instant";
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
    return formatSyncTime(d);
  };

  const activeAccount = activeTab === 'all' ? null : gmailAccounts.find((a) => String(a.id) === activeTab);
  const lastSyncAt = activeTab === 'all'
    ? gmailAccounts.reduce((latest, a) => (!latest || (a.last_sync_at && new Date(a.last_sync_at) > new Date(latest)) ? a.last_sync_at : latest), null)
    : activeAccount?.last_sync_at;
  const syncStatus = activeAccount?.sync_status;
  const syncLabel = syncStatus === 'active' ? 'Synchronisé' : syncStatus === 'syncing' ? 'Synchronisation…' : syncStatus === 'error' ? 'Erreur' : syncStatus === 'pending' ? 'En attente' : null;

  const setFolderAndReset = (f) => {
    setFolder(f);
    setPage(0);
    setSelectedEmail(null);
    setFoldersOpen(false);
  };

  const setAccountAndReset = (tab) => {
    setActiveTab(tab);
    setPage(0);
    setSelectedEmail(null);
    setFoldersOpen(false);
  };

  const safeHtml = (html) => {
    if (!html || typeof html !== 'string') return '';
    let out = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\s*on\w+\s*=\s*[^\s>]+/gi, '');
    out = out.replace(/<a\s+/gi, (m) => m + 'target="_blank" rel="noopener noreferrer" ');
    out = out.replace(/href\s*=\s*["']\s*javascript:[^"']*["']/gi, 'href="#"');
    out = out.replace(/href\s*=\s*["']\s*vbscript:[^"']*["']/gi, 'href="#"');
    return out;
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] md:min-h-[500px] overflow-hidden bg-white dark:bg-eva-panel">
      {/* Mobile overlay */}
      {foldersOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setFoldersOpen(false)} aria-hidden />
      )}
      {/* Left sidebar — collapsible on mobile */}
      <aside className={`fixed md:static inset-y-0 left-0 z-50 md:z-auto w-64 max-w-[85vw] md:w-52 flex-shrink-0 border-r border-slate-200 dark:border-slate-700/40 flex flex-col bg-slate-50 dark:bg-slate-900/30 transform transition-transform duration-200 ease-out top-[calc(3rem+env(safe-area-inset-top))] md:top-0 ${foldersOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="md:hidden p-2 border-b border-slate-200 dark:border-slate-700/40 flex justify-end">
          <button onClick={() => setFoldersOpen(false)} className="p-2 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white min-h-[44px] min-w-[44px] touch-manipulation" aria-label="Fermer">✕</button>
        </div>
        <a
          href="https://mail.google.com/mail/?view=cm"
          target="_blank"
          rel="noopener noreferrer"
          className="m-3 px-4 py-2.5 flex items-center justify-center gap-2 bg-[#0078D4] hover:bg-[#106EBE] text-white rounded text-sm font-medium transition-colors"
        >
          <span>+</span> Nouvel email
        </a>
        <nav className="px-2 pb-4">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-eva-muted uppercase tracking-wider px-2 py-1.5">Dossiers</div>
          {FOLDERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFolderAndReset(f.id)}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left text-sm ${
                folder === f.id ? 'bg-[#0078D4]/15 text-[#0078D4] dark:bg-[#0078D4]/20 dark:text-[#4DA3FF] font-medium' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/40'
              }`}
            >
              <span className="text-base">{f.icon}</span>
              <span className="truncate">{f.label}</span>
            </button>
          ))}
        </nav>
        {gmailAccounts.length > 1 && (
          <>
            <div className="text-[11px] font-semibold text-slate-500 dark:text-eva-muted uppercase tracking-wider px-2 py-1.5 mt-2">Comptes</div>
            <div className="space-y-0.5">
              <button
                onClick={() => setAccountAndReset('all')}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left text-sm truncate ${activeTab === 'all' ? 'bg-[#0078D4]/15 text-[#0078D4] dark:text-[#4DA3FF] font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/40'}`}
              >
                Tous les comptes
              </button>
              {gmailAccounts.map((acct) => (
                <button
                  key={acct.id}
                  onClick={() => setAccountAndReset(String(acct.id))}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left text-sm truncate ${activeTab === String(acct.id) ? 'bg-[#0078D4]/15 text-[#0078D4] dark:text-[#4DA3FF] font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/40'}`}
                  title={acct.gmail_address}
                >
                  {acct.gmail_address}
                </button>
              ))}
            </div>
          </>
        )}
        {gmailAccounts.length > 0 && lastSyncAt && (
          <div className="mt-auto px-2 py-2 text-[10px] text-slate-400 dark:text-slate-500" title={formatSyncTime(lastSyncAt)}>
            Sync: {formatRelativeTime(lastSyncAt)}
          </div>
        )}
      </aside>

      {/* Main: message list + reading pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar: search + mobile folders button */}
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700/40 bg-white dark:bg-eva-panel">
          <button type="button" onClick={() => setFoldersOpen(true)} className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 touch-manipulation" aria-label="Dossiers">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <form onSubmit={handleSearch} className="flex-1 flex gap-2 min-w-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher"
              className="flex-1 min-w-0 px-3 py-2 bg-slate-100 dark:bg-slate-800/60 border-0 rounded text-sm text-slate-900 dark:text-white placeholder:text-slate-500 focus:ring-2 focus:ring-[#0078D4]/30 focus:ring-inset"
            />
            <button type="submit" className="px-4 py-2 min-h-[44px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-sm font-medium hover:bg-slate-300 dark:hover:bg-slate-600 touch-manipulation">
              Rechercher
            </button>
          </form>
          {syncLabel && (
            <span className={`text-[10px] px-2 py-1 rounded ${syncStatus === 'active' ? 'bg-emerald-500/20 text-emerald-600' : syncStatus === 'syncing' ? 'bg-amber-500/20 text-amber-600' : syncStatus === 'error' ? 'bg-red-500/20 text-red-600' : 'bg-slate-200 text-slate-600'}`}>
              {syncLabel}
            </span>
          )}
        </div>

        {error && <div className="flex-shrink-0 px-3 py-2 text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20">{error}</div>}

        <div className="flex-1 flex min-h-0">
          {/* Message list — Outlook table style */}
          <div className={`flex flex-col border-r border-slate-200 dark:border-slate-700/40 ${selectedEmail ? 'w-full sm:w-80 md:w-96 flex-shrink-0' : 'flex-1 min-w-0'}`}>
            {loading ? (
              <div className="flex items-center justify-center flex-1">
                <div className="flex gap-1"><div className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse" /><div className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse" /><div className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse" /></div>
              </div>
            ) : emails.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-slate-500 dark:text-eva-muted text-sm text-center">
                  {search ? 'Aucun message trouvé.' : 'Aucun email. Connecte Gmail depuis Data Sources.'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex-shrink-0 grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800/40 text-[11px] font-semibold text-slate-500 dark:text-eva-muted uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/40">
                  <span>{folder === 'sent' ? 'À' : 'De'}</span>
                  <span>Objet</span>
                  <span className="text-right">Date</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {(() => {
                    const grouped = groupEmailsBySection(emails);
                    return SECTION_ORDER.map((section) => {
                      const sectionEmails = grouped[section];
                      if (!sectionEmails?.length) return null;
                    return (
                      <div key={section}>
                        <div className="sticky top-0 z-10 px-3 py-1.5 bg-slate-200/80 dark:bg-slate-700/60 text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/40">
                          {section}
                        </div>
                        {sectionEmails.map((email) => (
                          <button
                            key={email.id}
                            onClick={() => openEmail(email)}
                            className={`w-full text-left grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-2 px-3 py-3 md:py-2.5 min-h-[52px] border-b border-slate-100 dark:border-slate-700/20 hover:bg-slate-50 dark:hover:bg-slate-700/20 active:bg-slate-100 dark:active:bg-slate-700/30 touch-manipulation ${
                              selectedEmail?.id === email.id ? 'bg-[#0078D4]/10 dark:bg-[#0078D4]/15 border-l-2 border-l-[#0078D4]' : ''
                            } ${!email.is_read ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                          >
                            <div className="min-w-0 flex items-center gap-1">
                              <span className={`truncate text-sm ${!email.is_read ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                                {folder === 'sent' ? (Array.isArray(email.to_emails) ? email.to_emails[0] || '—' : email.to_emails || '—') : (email.from_name || email.from_email)}
                              </span>
                              {email.is_starred && <span className="text-amber-500 shrink-0">★</span>}
                              {email.has_attachments && <span className="text-slate-400 shrink-0">📎</span>}
                            </div>
                            <div className={`min-w-0 truncate text-sm ${!email.is_read ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>
                              {email.subject || '(sans objet)'}
                            </div>
                            <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0 self-center" title={new Date(email.received_at).toLocaleString('fr-FR')}>
                              {formatDate(email.received_at)}
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                    });
                  })()}
                </div>
                {total > PAGE_SIZE && (
                  <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-t border-slate-200 dark:border-slate-700/40 text-[11px] text-slate-500 dark:text-eva-muted">
                    <span>Page {page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
                    <div className="flex gap-1">
                      <button onClick={() => handlePageChange(page - 1)} disabled={page === 0} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 touch-manipulation">←</button>
                      <button onClick={() => handlePageChange(page + 1)} disabled={(page + 1) * PAGE_SIZE >= total} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 touch-manipulation">→</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Reading pane — Outlook style */}
          <div className={`flex-1 flex flex-col min-w-0 bg-slate-50/50 dark:bg-slate-900/20 ${!selectedEmail ? 'hidden md:flex md:items-center md:justify-center' : ''}`}>
            {detailLoading ? (
              <div className="flex items-center justify-center flex-1">
                <div className="flex gap-1"><div className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse" /><div className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse" /><div className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse" /></div>
              </div>
            ) : selectedEmail ? (
              <>
                <div className="flex-shrink-0 p-4 border-b border-slate-200 dark:border-slate-700/40 bg-white dark:bg-eva-panel relative">
                  <button onClick={() => setSelectedEmail(null)} className="md:hidden absolute top-2 left-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white touch-manipulation" aria-label="Retour">←</button>
                  <h1 className="text-lg font-semibold text-slate-900 dark:text-white pr-8">{selectedEmail.subject || '(sans objet)'}</h1>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-400">
                    <span><strong className="text-slate-500 dark:text-slate-500">De:</strong> {selectedEmail.from_name ? `${selectedEmail.from_name} <${selectedEmail.from_email}>` : selectedEmail.from_email}</span>
                    {selectedEmail.to_emails?.length > 0 && <span><strong className="text-slate-500 dark:text-slate-500">À:</strong> {Array.isArray(selectedEmail.to_emails) ? selectedEmail.to_emails.join(', ') : selectedEmail.to_emails}</span>}
                    {selectedEmail.cc_emails?.length > 0 && <span><strong className="text-slate-500 dark:text-slate-500">Cc:</strong> {Array.isArray(selectedEmail.cc_emails) ? selectedEmail.cc_emails.join(', ') : selectedEmail.cc_emails}</span>}
                    <span><strong className="text-slate-500 dark:text-slate-500">Date:</strong> {new Date(selectedEmail.received_at).toLocaleString('fr-FR')}</span>
                  </div>
                  {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700/30 flex flex-wrap gap-2">
                      {selectedEmail.attachments.map((att, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 bg-slate-100 dark:bg-slate-700/40 rounded text-xs text-slate-700 dark:text-slate-300">
                          <span>📎</span>
                          <span className="truncate max-w-[180px]" title={att.filename}>{att.filename}</span>
                          {att.size_bytes && <span className="text-slate-500">({att.size_bytes < 1024 ? att.size_bytes + ' o' : (att.size_bytes / 1024).toFixed(0) + ' Ko'})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {selectedEmail.body_html ? (
                    <div
                      className="prose prose-slate dark:prose-invert prose-sm max-w-none email-body"
                      dangerouslySetInnerHTML={{ __html: safeHtml(selectedEmail.body_html) }}
                    />
                  ) : (
                    <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                      {selectedEmail.body_plain || '(contenu vide)'}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <p className="text-slate-400 dark:text-slate-500 text-sm">Sélectionnez un message pour l&apos;afficher.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
