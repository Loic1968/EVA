import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Emails() {
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 30;

  const fetchEmails = async (searchQuery = '', pageNum = 0) => {
    setLoading(true);
    setError(null);
    try {
      let result;
      if (searchQuery.trim()) {
        result = await api.searchEmails(searchQuery, PAGE_SIZE);
      } else {
        result = await api.getEmails({ limit: PAGE_SIZE, offset: pageNum * PAGE_SIZE });
      }
      setEmails(result.emails || []);
      setTotal(result.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(0);
    fetchEmails(search, 0);
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchEmails(search, newPage);
  };

  const openEmail = async (email) => {
    setDetailLoading(true);
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

  // Email detail modal
  if (selectedEmail) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedEmail(null)}
          className="text-sm text-eva-accent hover:text-cyan-300 flex items-center gap-1"
        >
          ← Retour aux emails
        </button>
        <div className="bg-eva-panel rounded-xl border border-slate-700/40 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-medium text-white">{selectedEmail.subject || '(sans objet)'}</h2>
              <p className="text-sm text-eva-muted mt-1">
                De: <span className="text-slate-300">{selectedEmail.from_name ? `${selectedEmail.from_name} <${selectedEmail.from_email}>` : selectedEmail.from_email}</span>
              </p>
              {selectedEmail.to_emails?.length > 0 && (
                <p className="text-sm text-eva-muted">
                  À: <span className="text-slate-400">{selectedEmail.to_emails.join(', ')}</span>
                </p>
              )}
              {selectedEmail.cc_emails?.length > 0 && (
                <p className="text-sm text-eva-muted">
                  Cc: <span className="text-slate-400">{selectedEmail.cc_emails.join(', ')}</span>
                </p>
              )}
            </div>
            <span className="text-xs text-eva-muted whitespace-nowrap">
              {new Date(selectedEmail.received_at).toLocaleString('fr-FR')}
            </span>
          </div>

          {selectedEmail.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {selectedEmail.attachments.map((att, i) => (
                <span key={i} className="text-xs bg-slate-700/50 text-slate-300 px-2 py-1 rounded">
                  📎 {att.filename} {att.size_bytes ? `(${(att.size_bytes / 1024).toFixed(0)} KB)` : ''}
                </span>
              ))}
            </div>
          )}

          <div className="border-t border-slate-700/40 pt-4">
            {selectedEmail.body_html ? (
              <div
                className="prose prose-invert prose-sm max-w-none text-slate-300"
                dangerouslySetInnerHTML={{ __html: selectedEmail.body_html }}
              />
            ) : (
              <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans">{selectedEmail.body_plain || '(contenu vide)'}</pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Emails</h1>
        <p className="text-eva-muted text-sm mt-1">
          {total > 0 ? `${total.toLocaleString()} emails synchronisés depuis Gmail` : 'Connecte ton Gmail depuis Data Sources pour voir tes emails ici.'}
        </p>
      </div>

      {error && <div className="text-red-400 text-sm bg-red-500/10 rounded-lg px-4 py-2">{error}</div>}

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
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

      {/* Email list */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
            <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
            <div className="w-2 h-2 rounded-full bg-eva-accent eva-dot" />
          </div>
        </div>
      ) : emails.length === 0 ? (
        <div className="bg-eva-panel rounded-xl border border-slate-700/40 p-8 text-center">
          <p className="text-eva-muted text-sm">
            {search ? 'Aucun email trouvé pour cette recherche.' : 'Aucun email synchronisé. Connecte ton Gmail depuis Data Sources.'}
          </p>
        </div>
      ) : (
        <div className="bg-eva-panel rounded-xl border border-slate-700/40 overflow-hidden">
          <div className="divide-y divide-slate-700/30">
            {emails.map((email) => (
              <button
                key={email.id}
                onClick={() => openEmail(email)}
                className={`w-full text-left px-5 py-3 hover:bg-slate-700/20 transition-colors flex items-center gap-4 ${
                  !email.is_read ? 'bg-slate-700/10' : ''
                }`}
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
                <span className="text-xs text-eva-muted whitespace-nowrap shrink-0">
                  {formatDate(email.received_at)}
                </span>
              </button>
            ))}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="px-5 py-3 border-t border-slate-700/40 flex items-center justify-between">
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
        </div>
      )}
    </div>
  );
}
