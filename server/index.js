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
const evaRoutes = require('./routes/eva');

const app = express();
const PORT = process.env.EVA_PORT || process.env.PORT || 5002;

app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' })); // 2mb for voice audio base64

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'eva', timestamp: new Date().toISOString() });
});

// Realtime API (OpenAI WebRTC voice — ChatGPT-level) — no DB
const realtimeRoutes = require('./routes/realtime');
app.use('/api/realtime', realtimeRoutes);

// Voice API (no DB) — mounted before eva for reliability
const voiceRoutes = require('./routes/voice');
const API_KEY = process.env.EVA_API_KEY;
app.use('/api/voice', (req, res, next) => {
  if (API_KEY) {
    const key = req.headers['x-api-key'] || req.query.api_key;
    if (key !== API_KEY) return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
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
