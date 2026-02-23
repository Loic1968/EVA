/**
 * Project EVA – API server (independent app, same stack as Halisoft: Node + Express).
 * Serves API on /api and, in production, the React frontend from web/dist (SPA fallback).
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const baseEnvPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: baseEnvPath });
const localEnvPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: localEnvPath });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const evaRoutes = require('./routes/eva');

const app = express();
const PORT = process.env.EVA_PORT || process.env.PORT || 5002;
const isProd = process.env.NODE_ENV === 'production';
const API_KEY = process.env.EVA_API_KEY;

// Production: EVA_API_KEY strongly recommended (warn if missing, app still starts)
if (isProd && !process.env.EVA_API_KEY) {
  console.warn('[EVA] WARNING: EVA_API_KEY not set. Add it in Render → Environment for API protection.');
}

// Helmet – security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

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

app.use(express.json({ limit: '2mb' })); // 2mb for voice audio base64

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'eva', timestamp: new Date().toISOString() });
});

function apiKeyOrSameOrigin(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key === API_KEY) return next();
  if (isProd) {
    const origin = req.get('origin');
    if (!origin || allowedOrigins.includes(origin)) return next();
  }
  return res.status(401).json({ error: 'Invalid or missing API key' });
}

// Realtime API (OpenAI WebRTC voice — ChatGPT-level) — no DB
const realtimeRoutes = require('./routes/realtime');
app.use('/api/realtime', apiKeyOrSameOrigin, realtimeRoutes);

// Voice API (no DB) — mounted before eva for reliability
const voiceRoutes = require('./routes/voice');
app.use('/api/voice', (req, res, next) => {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key === API_KEY) return next();
  if (isProd) {
    const origin = req.get('origin');
    if (!origin || allowedOrigins.includes(origin)) return next();
  }
  return res.status(401).json({ error: 'Invalid or missing API key' });
}, voiceRoutes);
app.use('/api', evaRoutes);

// Serve frontend (web/dist) when built (e.g. on Render: single service for eva.halisoft.biz)
const distPath = path.join(__dirname, '../web/dist');
if (fs.existsSync(distPath)) {
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
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    try {
      const gmailWorker = require('./workers/gmailSyncWorker');
      gmailWorker.start();
    } catch (err) {
      console.warn('[EVA] Gmail sync worker failed to start:', err.message);
    }
  } else {
    console.log('[EVA] Gmail sync worker skipped (GOOGLE_CLIENT_ID not set)');
  }
});
