// EVA API client
// In production, set VITE_EVA_API_URL (e.g. https://api.eva.halisoft.biz) at build time
const API_BASE = import.meta.env.VITE_EVA_API_URL
  ? `${import.meta.env.VITE_EVA_API_URL.replace(/\/$/, '')}/api`
  : '/api';

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = new Error(res.statusText || 'Request failed');
    err.status = res.status;
    try { err.body = await res.json(); } catch (_) {}
    throw err;
  }
  return res.json();
}

export const api = {
  // Chat
  chat: (message, history, conversation_id) =>
    request('/chat', { method: 'POST', body: JSON.stringify({ message, history, conversation_id }) }),

  // Conversations
  getConversations: (params) => request('/conversations?' + new URLSearchParams(params || {})),
  createConversation: (title) => request('/conversations', { method: 'POST', body: JSON.stringify({ title }) }),
  getMessages: (convId) => request(`/conversations/${convId}/messages`),
  deleteConversation: (convId) => request(`/conversations/${convId}`, { method: 'DELETE' }),

  // Drafts
  getDrafts: (params) => request('/drafts?' + new URLSearchParams(params || {})),
  createDraft: (body) => request('/drafts', { method: 'POST', body: JSON.stringify(body) }),
  updateDraft: (id, body) => request(`/drafts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Audit logs
  getAuditLogs: (params) => request('/audit-logs?' + new URLSearchParams(params || {})),
  createAuditLog: (body) => request('/audit-logs', { method: 'POST', body: JSON.stringify(body) }),

  // Settings
  getSettings: () => request('/settings'),
  setSetting: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify(value) }),

  // Data sources
  getDataSources: () => request('/data-sources'),
  addDataSource: (body) => request('/data-sources', { method: 'POST', body: JSON.stringify(body) }),

  // Documents
  getDocuments: (params) => request('/documents?' + new URLSearchParams(params || {})),
  uploadDocument: async (file) => {
    const url = `${API_BASE}/documents/upload`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Filename': file.name },
      body: file,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },

  // Confidence summary
  getConfidenceSummary: () => request('/confidence-summary'),

  // Feedback
  sendFeedback: (body) => request('/feedback', { method: 'POST', body: JSON.stringify(body) }),

  // Stats
  getStats: () => request('/stats'),
};
