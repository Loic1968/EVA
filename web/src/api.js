// EVA API client
// In production, set VITE_EVA_API_URL (e.g. https://api.eva.halisoft.biz) at build time
// In dev: use /api (proxied) when on network (iPhone), else localhost:5002 for direct
function getApiBase() {
  if (import.meta.env.VITE_EVA_API_URL) {
    return `${import.meta.env.VITE_EVA_API_URL.replace(/\/$/, '')}/api`;
  }
  if (import.meta.env.DEV) {
    // On iPhone/remote: use same host (proxied by Vite)
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return `${window.location.origin}/api`;
    }
    return 'http://localhost:5002/api';
  }
  return '/api';
}
const API_BASE = getApiBase();

function getAuthHeaders() {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('eva_token') || sessionStorage.getItem('eva_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function onAuthFailure() {
  localStorage.removeItem('eva_token');
  sessionStorage.removeItem('eva_token');
  if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/signup') &&
      !window.location.pathname.startsWith('/forgot-password') && !window.location.pathname.startsWith('/reset-password')) {
    window.location.href = '/login?expired=1';
  }
}

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options.headers },
  });
  if (res.status === 401) {
    onAuthFailure();
    const err = new Error('Session expired. Please log in again.');
    err.status = 401;
    try { err.body = await res.json(); } catch (_) {}
    throw err;
  }
  if (!res.ok) {
    const err = new Error(res.statusText || 'Request failed');
    err.status = res.status;
    try { err.body = await res.json(); } catch (_) {}
    throw err;
  }
  return res.json();
}

export const api = {
  // Auth
  getAuthConfig: () => request('/auth/config'),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signup: (email, password, display_name) =>
    request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, display_name }) }),
  forgotPassword: (email) =>
    request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, email, password) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, email, password }) }),
  getAuthMe: (token) =>
    fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Unauthorized')))),

  // Chat (non-streaming)
  chat: (message, history, conversation_id) =>
    request('/chat', { method: 'POST', body: JSON.stringify({ message, history, conversation_id }) }),

  // Chat stream (SSE) — returns async iterable of { type, text?, reply?, ... }
  chatStream: async function* (message, history, conversation_id) {
    const url = `${API_BASE.replace(/\/$/, '')}/chat/stream`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ message, history, conversation_id }),
    });
    if (res.status === 401) { onAuthFailure(); throw new Error('Session expired'); }
    if (!res.ok) {
      const err = new Error(res.statusText || 'Stream failed');
      err.status = res.status;
      try { err.body = await res.json(); } catch (_) {}
      throw err;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\n\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            yield JSON.parse(line.slice(6));
          } catch (_) {}
        }
      }
    }
    if (buf.startsWith('data: ')) {
      try {
        yield JSON.parse(buf.slice(6));
      } catch (_) {}
    }
  },

  status: () => request('/status'),

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
    const formData = new FormData();
    formData.append('file', file, file.name);
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    });
    if (res.status === 401) { onAuthFailure(); throw new Error('Session expired'); }
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },
  processDocument: (id) => request(`/documents/${id}/process`, { method: 'POST' }),
  getDocumentContent: (id) => request(`/documents/${id}/content`),
  crawlWebsite: (url) => request('/documents/crawl', { method: 'POST', body: JSON.stringify({ url }) }),

  // Gmail OAuth & Emails
  getGmailAuthUrl: () => request('/oauth/gmail/start'),
  getGmailAccounts: () => request('/gmail/accounts'),
  syncGmail: (accountId) => request(`/gmail/sync/${accountId}`, { method: 'POST' }),
  disconnectGmail: (accountId) => request(`/gmail/accounts/${accountId}`, { method: 'DELETE' }),
  getEmails: (params) => request('/gmail/emails?' + new URLSearchParams(params || {})),
  getEmail: (id) => request(`/gmail/emails/${id}`),
  searchEmails: (q, limit = 20, gmailAccountId) =>
    request(`/gmail/emails?q=${encodeURIComponent(q)}&limit=${limit}` + (gmailAccountId ? `&gmail_account_id=${gmailAccountId}` : '')),

  // Confidence summary
  getConfidenceSummary: () => request('/confidence-summary'),

  // Feedback
  sendFeedback: (body) => request('/feedback', { method: 'POST', body: JSON.stringify(body) }),

  // Stats
  getStats: () => request('/stats'),

  // Voice (OpenAI Whisper + TTS) — ChatGPT-level oral
  voiceStatus: () => request('/voice/status'),
  voiceStt: async (audioBlob) => {
    const url = `${API_BASE.replace(/\/$/, '')}/voice/stt`;
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(audioBlob);
    });
    const t = (audioBlob.type || '').toLowerCase();
    const format = /mp4|m4a|x-m4a/.test(t) ? 'm4a' : /ogg|opus/.test(t) ? 'ogg' : /mpeg|mp3/.test(t) ? 'mp3' : 'webm';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ audio: base64, format }),
    });
    if (res.status === 401) { onAuthFailure(); throw new Error('Session expired'); }
    if (!res.ok) {
      const err = new Error(res.statusText || 'STT failed');
      err.status = res.status;
      try { err.body = await res.json(); } catch (_) {}
      throw err;
    }
    return res.json();
  },
  voiceTts: async (text) => {
    const url = `${API_BASE.replace(/\/$/, '')}/voice/tts`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ text: (text || '').slice(0, 4096), lang: 'auto' }),
    });
    if (res.status === 401) { onAuthFailure(); throw new Error('Session expired'); }
    if (!res.ok) {
      const err = new Error(res.statusText || 'TTS failed');
      err.status = res.status;
      throw err;
    }
    return res.blob();
  },
};
