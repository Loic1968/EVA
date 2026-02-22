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
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'eva', timestamp: new Date().toISOString() });
});

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

app.listen(PORT, () => {
  console.log(`[EVA] listening on port ${PORT}${fs.existsSync(distPath) ? ' (frontend served from web/dist)' : ''}`);

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
