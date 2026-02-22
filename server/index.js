/**
 * Project EVA – API server (independent app, same stack as Halisoft: Node + Express).
 * Port 5002 by default so it does not conflict with Halisoft backend (5001).
 */
require('dotenv').config();
const path = require('path');

const baseEnvPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: baseEnvPath });
const localEnvPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: localEnvPath });

const express = require('express');
const cors = require('cors');
const evaRoutes = require('./routes/eva');

const app = express();
// EVA runs on 5002 by default so it does not conflict with Halisoft (5001)
const PORT = process.env.EVA_PORT || process.env.PORT || 5002;

app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'eva', timestamp: new Date().toISOString() });
});

app.use('/api', evaRoutes);

app.use((err, req, res, next) => {
  console.error('[EVA]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[EVA] API listening on http://localhost:${PORT}`);
});
