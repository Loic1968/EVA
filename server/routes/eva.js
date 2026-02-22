/**
 * EVA API routes – chat, conversations, drafts, audit logs, settings, data sources, documents, stats.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const fs = require('fs');

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
    console.error('[EVA] ensureOwner failed:', e.message);
    const isDb = /DATABASE_URL|connection|ECONNREFUSED|timeout|relation "eva\./i.test(String(e.message || ''));
    res.status(isDb ? 503 : 500).json({
      error: isDb
        ? 'Database unavailable. On Render: set DATABASE_URL and run eva schema migration.'
        : (e.message || 'Server error'),
    });
  }
}

router.use(ensureOwner);

// ════════════════════════════════════════════════════════════════
// CHAT: Talk to EVA (with conversation persistence)
// ════════════════════════════════════════════════════════════════
const evaChat = require('../evaChat');

// List conversations
router.get('/conversations', async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;
    const r = await db.query(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM eva.messages m WHERE m.conversation_id = c.id) AS message_count
       FROM eva.conversations c
       WHERE c.owner_id = $1
       ORDER BY c.updated_at DESC
       LIMIT $2`,
      [req.ownerId, Math.min(Number(limit) || 20, 100)]
    );
    res.json({ conversations: r.rows });
  } catch (e) {
    next(e);
  }
});

// Create a new conversation
router.post('/conversations', async (req, res, next) => {
  try {
    const { title } = req.body || {};
    const r = await db.query(
      `INSERT INTO eva.conversations (owner_id, title) VALUES ($1, $2) RETURNING *`,
      [req.ownerId, title || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// Get messages for a conversation
router.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT id, role, content, tokens_used, created_at
       FROM eva.messages
       WHERE conversation_id = $1 AND owner_id = $2
       ORDER BY created_at ASC`,
      [req.params.id, req.ownerId]
    );
    res.json({ messages: r.rows });
  } catch (e) {
    next(e);
  }
});

// Delete a conversation
router.delete('/conversations/:id', async (req, res, next) => {
  try {
    await db.query(
      `DELETE FROM eva.conversations WHERE id = $1 AND owner_id = $2`,
      [req.params.id, req.ownerId]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Chat: send a message (optionally within a conversation)
router.post('/chat', async (req, res, next) => {
  try {
    const { message, history, conversation_id } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) required' });
    }

    // If conversation_id provided, load history from DB
    let chatHistory = Array.isArray(history) ? history : [];
    let convId = conversation_id ? Number(conversation_id) : null;

    if (convId && chatHistory.length === 0) {
      const histResult = await db.query(
        `SELECT role, content FROM eva.messages
         WHERE conversation_id = $1 AND owner_id = $2
         ORDER BY created_at ASC`,
        [convId, req.ownerId]
      );
      chatHistory = histResult.rows;
    }

    const result = await evaChat.reply(message.trim(), chatHistory);

    // Persist messages if we have a conversation
    if (convId) {
      // Save user message
      await db.query(
        `INSERT INTO eva.messages (conversation_id, owner_id, role, content) VALUES ($1, $2, 'user', $3)`,
        [convId, req.ownerId, message.trim()]
      );
      // Save assistant reply
      await db.query(
        `INSERT INTO eva.messages (conversation_id, owner_id, role, content, tokens_used) VALUES ($1, $2, 'assistant', $3, $4)`,
        [convId, req.ownerId, result.reply, (result.tokens?.input || 0) + (result.tokens?.output || 0)]
      );
      // Update conversation title if first message
      await db.query(
        `UPDATE eva.conversations SET updated_at = now(),
         title = COALESCE(NULLIF(title, ''), $3)
         WHERE id = $1 AND owner_id = $2`,
        [convId, req.ownerId, message.trim().slice(0, 100)]
      );
    }

    // Audit log
    await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'query', 'chat', $2)`,
      [req.ownerId, JSON.stringify({
        message: message.slice(0, 500),
        replyLength: result.reply.length,
        model: result.model,
        tokens: result.tokens,
        conversation_id: convId,
      })]
    );

    res.json({
      reply: result.reply,
      model: result.model,
      tokens: result.tokens,
      conversation_id: convId,
    });
  } catch (e) {
    next(e);
  }
});

// ════════════════════════════════════════════════════════════════
// DRAFTS (Phase 2–3: approve before send)
// ════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════
// SETTINGS (kill switch, permission tiers)
// ════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════
// DATA SOURCES (ingestion registrations)
// ════════════════════════════════════════════════════════════════
router.get('/data-sources', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT id, source_type, external_id, config, status, last_sync_at, record_count, created_at
       FROM eva.data_sources WHERE owner_id = $1 ORDER BY source_type`,
      [req.ownerId]
    );
    res.json({ sources: r.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/data-sources', async (req, res, next) => {
  try {
    const { source_type, external_id, config } = req.body;
    if (!source_type) return res.status(400).json({ error: 'source_type required' });
    const r = await db.query(
      `INSERT INTO eva.data_sources (owner_id, source_type, external_id, config)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.ownerId, source_type, external_id || null, JSON.stringify(config || {})]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// ════════════════════════════════════════════════════════════════
// DOCUMENTS (file upload for Memory Vault)
// ════════════════════════════════════════════════════════════════
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

router.get('/documents', async (req, res, next) => {
  try {
    const { status, limit = 50 } = req.query;
    let q = 'SELECT id, filename, file_type, file_size, status, metadata, chunk_count, created_at, processed_at FROM eva.documents WHERE owner_id = $1';
    const params = [req.ownerId];
    if (status) {
      params.push(status);
      q += ` AND status = $${params.length}`;
    }
    q += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(Math.min(Number(limit) || 50, 200));
    const r = await db.query(q, params);
    res.json({ documents: r.rows });
  } catch (e) {
    next(e);
  }
});

// Simple file upload (multipart or base64 JSON)
router.post('/documents/upload', express.raw({ type: '*/*', limit: '50mb' }), async (req, res, next) => {
  try {
    // Ensure upload dir exists
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    const filename = req.headers['x-filename'] || `upload_${Date.now()}`;
    const fileType = path.extname(filename).replace('.', '').toLowerCase() || 'unknown';
    const filePath = path.join(UPLOAD_DIR, `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`);

    fs.writeFileSync(filePath, req.body);
    const fileSize = fs.statSync(filePath).size;

    const r = await db.query(
      `INSERT INTO eva.documents (owner_id, filename, file_type, file_size, storage_path, status)
       VALUES ($1, $2, $3, $4, $5, 'uploaded') RETURNING *`,
      [req.ownerId, filename, fileType, fileSize, filePath]
    );

    // Audit log
    await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'file_uploaded', 'documents', $2)`,
      [req.ownerId, JSON.stringify({ filename, fileType, fileSize })]
    );

    res.status(201).json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// ════════════════════════════════════════════════════════════════
// CONFIDENCE SCORE SUMMARY (dashboard)
// ════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════
// FEEDBACK (behavioral corrections)
// ════════════════════════════════════════════════════════════════
router.post('/feedback', async (req, res, next) => {
  try {
    const { message_id, draft_id, feedback_type, original_text, corrected_text, notes } = req.body;
    if (!feedback_type) return res.status(400).json({ error: 'feedback_type required' });
    const r = await db.query(
      `INSERT INTO eva.feedback (owner_id, message_id, draft_id, feedback_type, original_text, corrected_text, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.ownerId, message_id || null, draft_id || null, feedback_type, original_text || null, corrected_text || null, notes || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// ════════════════════════════════════════════════════════════════
// STATS (dashboard metrics)
// ════════════════════════════════════════════════════════════════
router.get('/stats', async (req, res, next) => {
  try {
    const [convos, msgs, draftsR, logsR, docsR] = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM eva.conversations WHERE owner_id = $1', [req.ownerId]),
      db.query('SELECT COUNT(*) AS count FROM eva.messages WHERE owner_id = $1', [req.ownerId]),
      db.query(`SELECT status, COUNT(*) AS count FROM eva.drafts WHERE owner_id = $1 GROUP BY status`, [req.ownerId]),
      db.query(`SELECT COUNT(*) AS count FROM eva.audit_logs WHERE owner_id = $1 AND created_at > now() - interval '7 days'`, [req.ownerId]),
      db.query('SELECT COUNT(*) AS count, COALESCE(SUM(file_size), 0) AS total_size FROM eva.documents WHERE owner_id = $1', [req.ownerId]),
    ]);

    const draftsByStatus = {};
    (draftsR.rows || []).forEach((r) => { draftsByStatus[r.status] = Number(r.count); });

    res.json({
      conversations: Number(convos.rows[0]?.count || 0),
      messages: Number(msgs.rows[0]?.count || 0),
      drafts: draftsByStatus,
      audit_logs_7d: Number(logsR.rows[0]?.count || 0),
      documents: Number(docsR.rows[0]?.count || 0),
      documents_size: Number(docsR.rows[0]?.total_size || 0),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
