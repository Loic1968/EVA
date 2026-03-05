// EVA API client
// In production, set VITE_EVA_API_URL (e.g. https://api.eva.halisoft.biz) at build time
// In dev: use /api (proxied) when on network (iPhone), else localhost:5002 for direct
function getApiBase() {
  if (import.meta.env.VITE_EVA_API_URL) {
    return `${import.meta.env.VITE_EVA_API_URL.replace(/\/$/, '')}/api`;
  }
  if (import.meta.env.DEV) {
    // Always use same origin in dev → Vite proxy forwards /api to 5002
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/api`;
    }
    return 'http://localhost:3001/api';
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
    try {
      const body = await res.json();
      err.body = body;
      if (body?.error) err.message = body.error;
    } catch (_) {}
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

  // Chat (non-streaming). opts: { origin: 'voice' } for voice input (disables memory writes).
  chat: (message, history, conversation_id, document_ids, opts = {}) =>
    request('/chat', { method: 'POST', body: JSON.stringify({ message, history, conversation_id, document_ids, origin: opts.origin }) }),

  // EVA Chat (pure ChatGPT-like) — streaming, returns Response for stream consumption.
  // Pass opts.origin: 'voice' when input comes from voice (helps EVA handle transcription errors).
  evaChat: async (messages, opts = {}) => {
    const res = await fetch(`${API_BASE.replace(/\/$/, '')}/eva/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ messages, origin: opts.origin }),
      signal: opts.signal,
    });
    if (res.status === 401) {
      onAuthFailure();
      throw new Error('Session expired');
    }
    return res;
  },

  // Chat stream (SSE) — returns async iterable of { type, text?, reply?, ... }
  // Pass { signal } to abort, { origin: 'voice' } for voice (disables memory writes).
  chatStream: async function* (message, history, conversation_id, document_ids, opts = {}) {
    const url = `${API_BASE.replace(/\/$/, '')}/chat/stream`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ message, history, conversation_id, document_ids, origin: opts.origin }),
      signal: opts.signal,
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

  status: () => request('/status?t=' + Date.now()),

  // Conversations
  getConversations: (params) => request('/conversations?' + new URLSearchParams(params || {})),
  createConversation: (title) => request('/conversations', { method: 'POST', body: JSON.stringify({ title }) }),
  getMessages: (convId) => request(`/conversations/${convId}/messages`),
  deleteConversation: (convId) => request(`/conversations/${convId}`, { method: 'DELETE' }),

  // Drafts
  getDrafts: (params) => request('/drafts?' + new URLSearchParams(params || {})),
  createDraft: (body) => request('/drafts', { method: 'POST', body: JSON.stringify(body) }),
  updateDraft: (id, body) => request(`/drafts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  sendDraft: (id) => request(`/drafts/${id}/send`, { method: 'POST' }),

  // Audit logs
  getAuditLogs: (params) => request('/audit-logs?' + new URLSearchParams(params || {})),
  createAuditLog: (body) => request('/audit-logs', { method: 'POST', body: JSON.stringify(body) }),

  // Settings
  getSettings: () => request('/settings'),
  setSetting: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify(value) }),
  getFeatureFlags: () => request('/settings/flags'),
  setFeatureFlag: (key, enabled) => request(`/settings/flags/${key}`, { method: 'POST', body: JSON.stringify({ enabled }) }),

  getMcpStatus: () => request('/mcp/status'),
  triggerMcpConnect: () => request('/mcp/connect', { method: 'POST' }),

  // Push notifications (browser/phone)
  getPushVapidPublic: () => request('/push/vapid-public'),
  getPushStatus: () => request('/push/status'),
  subscribePush: (subscription) => request('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) }),

  // Location (for EVA: "where am I")
  getLocation: () => request('/me/location'),
  setLocation: (city) => request('/me/location', { method: 'PUT', body: JSON.stringify({ city }) }),

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
    if (!res.ok) {
      let msg = res.status === 413 ? 'File too large (max 50 MB)' : 'Upload failed';
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch (_) {
        const txt = await res.text().catch(() => '');
        if (txt && txt.length < 200) msg = txt;
      }
      throw new Error(msg);
    }
    return res.json();
  },
  processDocument: (id) => request(`/documents/${id}/process`, { method: 'POST' }),
  reindexDocuments: () => request('/documents/reindex', { method: 'POST' }),
  getDocumentContent: (id) => request(`/documents/${id}/content`),
  getDocumentFile: async (id) => {
    const url = `${API_BASE.replace(/\/$/, '')}/documents/${id}/file`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (res.status === 401) { onAuthFailure(); throw new Error('Session expired'); }
    if (!res.ok) {
      const err = new Error(res.statusText || 'Failed to load file');
      err.status = res.status;
      try { err.body = await res.json(); } catch (_) {}
      throw err;
    }
    return res.blob();
  },
  deleteDocument: (id) => request(`/documents/${id}`, { method: 'DELETE' }),
  crawlWebsite: (url) => request('/documents/crawl', { method: 'POST', body: JSON.stringify({ url }) }),

  // Gmail OAuth & Emails
  getGmailAuthUrl: () => request('/oauth/gmail/start'),
  getGmailAccounts: () => request('/gmail/accounts'),
  syncGmail: (accountId) => request(`/gmail/sync/${accountId}`, { method: 'POST' }),
  disconnectGmail: (accountId) => request(`/gmail/accounts/${accountId}`, { method: 'DELETE' }),
  getEmails: (params) => request('/gmail/emails?' + new URLSearchParams(params || {})),
  getEmail: (id) => request(`/gmail/emails/${id}`),
  searchEmails: (q, limit = 20, gmailAccountId, folder) => {
    const p = new URLSearchParams({ q, limit });
    if (gmailAccountId) p.set('gmail_account_id', gmailAccountId);
    if (folder) p.set('folder', folder);
    return request(`/gmail/emails?${p}`);
  },

  // Calendar (Google Calendar via same OAuth as Gmail)
  syncCalendar: () => request('/calendar/sync', { method: 'POST' }),
  getCalendarEvents: (params) => request('/calendar/events?' + new URLSearchParams(params || {})),

  // Confidence summary
  getConfidenceSummary: () => request('/confidence-summary'),

  // Feedback
  sendFeedback: (body) => request('/feedback', { method: 'POST', body: JSON.stringify(body) }),

  // Stats
  getStats: () => request('/stats'),

  // Voice (OpenAI Whisper + TTS) — ChatGPT-level oral
  voiceStatus: (() => {
    let cache = null;
    let cacheTs = 0;
    let pending = null;
    const TTL_MS = 60_000;
    return () => {
      if (cache && Date.now() - cacheTs < TTL_MS) return Promise.resolve(cache);
      if (pending) return pending;
      pending = request('/voice/status').then((r) => { cache = r; cacheTs = Date.now(); pending = null; return r; }).catch((e) => { pending = null; throw e; });
      return pending;
    };
  })(),
  voiceStt: async (audioBlob, opts = {}) => {
    const url = `${API_BASE.replace(/\/$/, '')}/voice/stt`;
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(audioBlob);
    });
    const t = (audioBlob.type || '').toLowerCase();
    const format = /webm/.test(t) ? 'webm' : /mp4|m4a|x-m4a/.test(t) ? 'm4a' : /ogg|oga/.test(t) ? 'ogg' : /mpeg|mp3/.test(t) ? 'mp3' : 'webm';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 85000); // 85s (server has 90s)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ audio: base64, format, lang: opts.lang || 'fr' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.status === 401) { onAuthFailure(); throw new Error('Session expired'); }
    if (!res.ok) {
      const err = new Error('STT failed');
      err.status = res.status;
      try {
        const body = await res.json();
        err.body = body;
        if (body?.error) err.message = body.error;
      } catch (_) {}
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

  /**
   * Streaming TTS — returns an async generator of mp3 Blobs (one per sentence).
   * Frontend can play each chunk immediately for much faster time-to-first-audio.
   */
  voiceTtsStream: async function* (text) {
    const url = `${API_BASE.replace(/\/$/, '')}/voice/tts-stream`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ text: (text || '').slice(0, 4096), lang: 'auto' }),
    });
    if (res.status === 401) { onAuthFailure(); throw new Error('Session expired'); }
    if (!res.ok) throw new Error(res.statusText || 'TTS stream failed');
    const reader = res.body.getReader();
    let buffer = new Uint8Array(0);
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        // Append to buffer
        const tmp = new Uint8Array(buffer.length + value.length);
        tmp.set(buffer);
        tmp.set(value, buffer.length);
        buffer = tmp;
      }
      // Parse frames: [4 bytes length][N bytes mp3]
      while (buffer.length >= 4) {
        const len = (buffer[0] << 24) | (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
        if (len === 0) return; // end marker
        if (buffer.length < 4 + len) break; // need more data
        const mp3 = buffer.slice(4, 4 + len);
        buffer = buffer.slice(4 + len);
        yield new Blob([mp3], { type: 'audio/mpeg' });
      }
      if (done) break;
    }
  },

  /** Get/save voice settings */
  getVoiceSettings: () => request('/voice/settings'),
  saveVoiceSettings: (settings) => request('/voice/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }),
};
