/**
 * EVA API routes – drafts, audit logs, settings, data sources.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');

const API_KEY = process.env.EVA_API_KEY;

function optionalAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (API_KEY && key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

router.use(optionalAuth);

// Default owner for single-user (Phase 1–2). Replace with real auth later.
const DEFAULT_OWNER_EMAIL = process.env.EVA_OWNER_EMAIL || 'loic@halisoft.biz';

async function ensureOwner(req, res, next) {
  try {
    const owner = await db.getOrCreateOwner(DEFAULT_OWNER_EMAIL, 'Loic Hennocq');
    req.ownerId = owner.id;
    next();
  } catch (e) {
    next(e);
  }
}

router.use(ensureOwner);

// --- Drafts (Phase 2–3: approve before send) ---
router.get('/drafts', async (req, res, next) => {
  try {
    const { status, limit = 50 } = req.query;
    let q = 'SELECT id, channel, thread_id, subject_or_preview, body, confidence_score, status, sent_at, created_at FROM eva.drafts WHERE owner_id = $1';
    const params = [req.ownerId];
    if (status) {
      params.push(status);
      q += ` AND status = $${params.length}`;
    }
    q += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
  params.push(Math.min(Number(limit) || 50, 100));
    const r = await db.query(q, params);
    res.json({ drafts: r.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/drafts', async (req, res, next) => {
  try {
    const { channel, thread_id, subject_or_preview, body, confidence_score } = req.body;
    if (!channel || body == null) {
      return res.status(400).json({ error: 'channel and body required' });
    }
    const r = await db.query(
      `INSERT INTO eva.drafts (owner_id, channel, thread_id, subject_or_preview, body, confidence_score, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, channel, thread_id, subject_or_preview, body, confidence_score, status, created_at`,
      [req.ownerId, channel, thread_id || null, subject_or_preview || null, body, confidence_score != null ? Number(confidence_score) : null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch('/drafts/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, body } = req.body;
    const updates = [];
    const params = [req.ownerId, id];
    if (status) {
      params.push(status);
      updates.push(`status = $${params.length}`);
      if (status === 'sent') updates.push('sent_at = now()');
    }
    if (body != null) {
      params.push(body);
      updates.push(`body = $${params.length}`);
    }
    updates.push('updated_at = now()');
    if (updates.length <= 1) return res.status(400).json({ error: 'Nothing to update' });
    const r = await db.query(
      `UPDATE eva.drafts SET ${updates.join(', ')} WHERE owner_id = $1 AND id = $2 RETURNING id, status, sent_at, updated_at`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Draft not found' });
    res.json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// --- Audit logs ---
router.get('/audit-logs', async (req, res, next) => {
  try {
    const { limit = 100, action_type } = req.query;
    let q = 'SELECT id, action_type, channel, details, confidence_score, created_at FROM eva.audit_logs WHERE owner_id = $1';
    const params = [req.ownerId];
    if (action_type) {
      params.push(action_type);
      q += ` AND action_type = $${params.length}`;
    }
    q += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(Math.min(Number(limit) || 100, 500));
    const r = await db.query(q, params);
    res.json({ logs: r.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/audit-logs', async (req, res, next) => {
  try {
    const { action_type, channel, details, confidence_score } = req.body;
    if (!action_type) return res.status(400).json({ error: 'action_type required' });
    const r = await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details, confidence_score)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, action_type, channel, created_at`,
      [req.ownerId, action_type, channel || null, JSON.stringify(details || {}), confidence_score != null ? Number(confidence_score) : null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// --- Settings (kill switch, permission tiers) ---
router.get('/settings', async (req, res, next) => {
  try {
    const r = await db.query('SELECT key, value FROM eva.settings WHERE owner_id = $1', [req.ownerId]);
    const settings = {};
    r.rows.forEach((row) => { settings[row.key] = row.value; });
    res.json(settings);
  } catch (e) {
    next(e);
  }
});

router.put('/settings/:key', async (req, res, next) => {
  try {
    const { key } = req.params;
    const value = req.body;
    await db.query(
      `INSERT INTO eva.settings (owner_id, key, value, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (owner_id, key) DO UPDATE SET value = $3, updated_at = now()`,
      [req.ownerId, key, JSON.stringify(value)]
    );
    res.json({ key, value });
  } catch (e) {
    next(e);
  }
});

// --- Data sources (ingestion status) ---
router.get('/data-sources', async (req, res, next) => {
  try {
    const r = await db.query(
      'SELECT id, source_type, external_id, config, last_sync_at, created_at FROM eva.data_sources WHERE owner_id = $1 ORDER BY source_type',
      [req.ownerId]
    );
    res.json({ sources: r.rows });
  } catch (e) {
    next(e);
  }
});

// --- Confidence score summary (dashboard) ---
router.get('/confidence-summary', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT category, AVG(score) AS avg_score, SUM(sample_count) AS samples, MAX(recorded_at) AS last_at
       FROM eva.confidence_scores WHERE owner_id = $1 AND recorded_at > now() - interval '30 days'
       GROUP BY category ORDER BY last_at DESC`,
      [req.ownerId]
    );
    res.json({ categories: r.rows });
  } catch (e) {
    next(e);
  }
});

// --- Chat: talk to EVA (AI agent) ---
const evaChat = require('../evaChat');

router.post('/chat', async (req, res, next) => {
  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) required' });
    }
    const { reply } = await evaChat.reply(message.trim(), Array.isArray(history) ? history : []);
    await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'query', 'chat', $2)`,
      [req.ownerId, JSON.stringify({ message: message.slice(0, 500), replyLength: reply.length })]
    );
    res.json({ reply });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
