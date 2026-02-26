/**
 * Project EVA – API server (independent app, same stack as Halisoft: Node + Express).
 * Serves API on /api and, in production, the React frontend from web/dist (SPA fallback).
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Load .env — parent first (DATABASE_URL), then eva (overrides)
const baseEnvPath = path.resolve(__dirname, '../../.env');
const localEnvPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(baseEnvPath)) require('dotenv').config({ path: baseEnvPath });
if (fs.existsSync(localEnvPath)) require('dotenv').config({ path: localEnvPath });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const evaRoutes = require('./routes/eva');
const authRoutes = require('./routes/auth');
const { verifyAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.EVA_PORT || process.env.PORT || 5002;
const isProd = process.env.NODE_ENV === 'production';
const API_KEY = process.env.EVA_API_KEY;

// Production: EVA_API_KEY strongly recommended (warn if missing, app still starts)
if (isProd && !process.env.EVA_API_KEY) {
  console.warn('[EVA] WARNING: EVA_API_KEY not set. Add it in Render → Environment for API protection.');
}
// Dev: warn if EVA_FRONTEND_URL uses wrong port (EVA Vite = 3001, not 5173)
if (!isProd && process.env.EVA_FRONTEND_URL && /:5173(\/|$)/.test(process.env.EVA_FRONTEND_URL)) {
  console.warn('[EVA] EVA_FRONTEND_URL uses port 5173 but EVA Vite runs on 3001. Change to http://localhost:3001');
}

// Helmet – security headers (CSP allows OpenAI Realtime for voice, Nominatim for geocoding)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.openai.com", "wss://api.openai.com", "https://nominatim.openstreetmap.org", "https://api.anthropic.com"],
      mediaSrc: ["'self'", "blob:", "https://api.openai.com"],
      frameSrc: ["'self'", "blob:"],
      objectSrc: ["'self'", "blob:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    },
  },
}));

// CORS – restrictive in prod: only eva.halisoft.biz and configured origins
const allowedOrigins = (process.env.EVA_ALLOWED_ORIGINS || 'https://eva.halisoft.biz,https://www.eva.halisoft.biz')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const corsOptions = isProd && allowedOrigins.length > 0
  ? { origin: (origin, cb) => (!origin || allowedOrigins.includes(origin) ? cb(null, true) : cb(null, false)), credentials: true }
  : { origin: true };
app.use(cors(corsOptions));

// Rate limiting – 100 req/15min per IP (stricter for OAuth & chat)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 100 : 500,
  message: { error: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
}));
const apiStrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 30 : 150,
  message: { error: 'Too many API requests. Try again later.' },
});
app.use('/api/chat', apiStrictLimiter);
app.use('/api/chat/stream', apiStrictLimiter);
app.use('/api/oauth', apiStrictLimiter);
app.use('/api/voice', apiStrictLimiter);
app.use('/api/realtime', apiStrictLimiter);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/health', async (req, res) => {
  try {
    const db = require('./db');
    await db.getOrCreateOwner(process.env.EVA_OWNER_EMAIL || 'loic@halisoft.biz', 'Loic Hennocq');
    res.json({ status: 'ok', app: 'eva', db: 'ok', timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('[EVA] health check failed:', e.message);
    res.status(503).json({ status: 'error', app: 'eva', db: 'fail', error: e.message });
  }
});

function apiKeyOrSameOrigin(req, res, next) {
  if (!isProd) return next(); // Dev: no API key required
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key === API_KEY) return next();
  const origin = req.get('origin');
  if (!origin || allowedOrigins.includes(origin)) return next();
  return res.status(401).json({ error: 'Invalid or missing API key' });
}

// Auth (public)
app.use('/api/auth', authRoutes);

// Gmail OAuth callback — PUBLIC (Google redirects with ?code&state; no JWT). Must be before eva.
const oauthCallback = require('./routes/oauth').gmailCallback;
app.get('/api/oauth/gmail/callback', oauthCallback);

// Realtime API — requires auth for owner context
const realtimeRoutes = require('./routes/realtime');
app.use('/api/realtime', verifyAuth, apiKeyOrSameOrigin, realtimeRoutes);

// Voice API
const voiceRoutes = require('./routes/voice');
app.use('/api/voice', verifyAuth, apiKeyOrSameOrigin, voiceRoutes);

// Main API (chat, documents, settings, etc.)
app.use('/api', evaRoutes);

// Serve frontend (web/dist) when built (e.g. on Render: single service for eva.halisoft.biz)
const distPath = path.join(__dirname, '../web/dist');
const frontendUrl = process.env.EVA_FRONTEND_URL || process.env.EVA_WEB_URL;

if (frontendUrl && !isProd) {
  // Dev: redirect page requests to Vite frontend so 5002/sources → localhost:3001/sources
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    const base = frontendUrl.replace(/\/$/, '');
    return res.redirect(base + req.originalUrl);
  });
} else if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('[EVA]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const HOST = process.env.EVA_HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  const voice = process.env.OPENAI_API_KEY ? ' (voice: Whisper + TTS)' : '';
  console.log(`[EVA] listening on ${HOST}:${PORT}${voice}${fs.existsSync(distPath) ? ' (frontend served from web/dist)' : ''}`);

  // Start Gmail background sync worker (Phase 2)
  const hasGmail = (process.env.EVA_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
    (process.env.EVA_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET);
  if (hasGmail) {
    try {
      const gmailWorker = require('./workers/gmailSyncWorker');
      gmailWorker.start();
    } catch (err) {
      console.warn('[EVA] Gmail sync worker failed to start:', err.message);
    }
  } else {
    console.log('[EVA] Gmail sync worker skipped (EVA_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_ID not set)');
  }

  // Notification worker — calendar reminders
  if (hasGmail) {
    try {
      const notificationWorker = require('./workers/notificationWorker');
      notificationWorker.start();
    } catch (err) {
      console.warn('[EVA] Notification worker failed to start:', err.message);
    }
    // Email importance worker — notify when important email arrives (Gmail label + optional AI)
    try {
      const emailImportanceWorker = require('./workers/emailImportanceWorker');
      emailImportanceWorker.start();
    } catch (err) {
      console.warn('[EVA] Email importance worker failed to start:', err.message);
    }
  }
});
