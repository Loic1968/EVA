// In production, set VITE_EVA_API_URL (e.g. https://api.eva.halisoft.biz) at build time if API is on another host
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
    try {
      err.body = await res.json();
    } catch (_) {}
    throw err;
  }
  return res.json();
}

export const api = {
  getDrafts: (params) => request('/drafts?' + new URLSearchParams(params || {})),
  createDraft: (body) => request('/drafts', { method: 'POST', body: JSON.stringify(body) }),
  updateDraft: (id, body) => request(`/drafts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  getAuditLogs: (params) => request('/audit-logs?' + new URLSearchParams(params || {})),
  createAuditLog: (body) => request('/audit-logs', { method: 'POST', body: JSON.stringify(body) }),

  getSettings: () => request('/settings'),
  setSetting: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify(value) }),

  getDataSources: () => request('/data-sources'),
  getConfidenceSummary: () => request('/confidence-summary'),

  chat: (message, history) => request('/chat', { method: 'POST', body: JSON.stringify({ message, history }) }),
};
