/**
 * EVA API routes – chat, conversations, drafts, audit logs, settings, data sources, documents, gmail, stats.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const fs = require('fs');

// Gmail & Calendar services
const googleOAuth = require('../services/googleOAuth');
const gmailSync = require('../services/gmailSync');
const calendarSync = require('../services/calendarSync');
const { getKillSwitch, getShadowMode, getAutonomousMode, getStyleProfile } = require('../services/settingsService');
const gmailSend = require('../services/gmailSend');

const { verifyAuth } = require('../middleware/auth');
router.use(verifyAuth);

// EVA chat enabled when Claude API key is set; otherwise chat returns 503
const EVA_ENABLED = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

router.get('/status', (req, res) => {
  res.json({
    eva_enabled: EVA_ENABLED,
    ...(EVA_ENABLED ? {} : { error: 'Set ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in Render → Environment.' }),
  });
});

// ════════════════════════════════════════════════════════════════
// CHAT: Talk to EVA (with conversation persistence)
// ════════════════════════════════════════════════════════════════
const evaChat = require('../evaChat');

function evaDisabled(res) {
  res.status(503).json({
    error: 'EVA is currently disabled. Set ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in Render → Environment.',
    eva_enabled: false,
  });
}

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
    if (!EVA_ENABLED) return evaDisabled(res);
    const killOn = await getKillSwitch(req.ownerId);
    if (killOn) return res.status(503).json({ error: 'EVA paused (kill switch)', kill_switch: true });

    const { message, history, conversation_id, document_ids } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) required' });
    }

    let attachedDocuments = [];
    if (Array.isArray(document_ids) && document_ids.length > 0 && req.ownerId) {
      const docProcessor = require('../services/documentProcessor');
      for (const docId of document_ids) {
        const id = Number(docId);
        if (!id) continue;
        const r = await db.query(
          'SELECT id, filename, content_text, status FROM eva.documents WHERE id = $1 AND owner_id = $2',
          [id, req.ownerId]
        );
        const doc = r.rows[0];
        if (!doc) continue;
        if (!doc.content_text && ['uploaded', 'processing', 'error'].includes(doc.status)) {
          try { await docProcessor.processDocument(id, req.ownerId); } catch (_) {}
          const up = await db.query('SELECT content_text FROM eva.documents WHERE id = $1', [id]);
          doc.content_text = up.rows[0]?.content_text || '';
        }
        attachedDocuments.push({ id: doc.id, filename: doc.filename, content_text: doc.content_text });
      }
    }

    const parsed = evaChat.parseCommand(message.trim());
    const { command, message: parsedMsg, mode } = parsed;

    // Memory commands => no LLM call
    if (command === 'remember' || command === 'correct' || command === 'forget' || command === 'memory') {
      const memoryItems = require('../services/memoryItemsService');
      const useStructured = process.env.EVA_STRUCTURED_MEMORY === 'true';
      const factsService = useStructured ? require('../services/factsService') : null;
      try {
        if (command === 'remember') {
          const id = await memoryItems.addMemoryItem(req.ownerId, 'preference', parsed.key, parsed.value);
          if (useStructured && factsService) await factsService.addRemember(req.ownerId, parsed.key, parsed.value);
          return res.json({ reply: id ? `Noté. Préférence "${parsed.key}" enregistrée.` : 'Erreur.', model: null, tokens: { input: 0, output: 0 } });
        }
        if (command === 'correct') {
          const id = await memoryItems.addMemoryItem(req.ownerId, 'correction', parsed.key, parsed.value);
          if (useStructured && factsService) await factsService.addCorrection(req.ownerId, parsed.key, parsed.value);
          return res.json({ reply: id ? `Correction enregistrée : ${parsed.key} = ${parsed.value}` : 'Erreur.', model: null, tokens: { input: 0, output: 0 } });
        }
        if (command === 'forget') {
          let ok = await memoryItems.deleteByKey(req.ownerId, parsed.key);
          if (useStructured && factsService) ok = (await factsService.deleteFact(req.ownerId, parsed.key)) || ok;
          return res.json({ reply: ok ? `Oublié : ${parsed.key}` : `Aucune mémoire trouvée pour "${parsed.key}"`, model: null, tokens: { input: 0, output: 0 } });
        }
        if (command === 'memory') {
          let keys = [];
          if (useStructured && factsService) {
            const facts = await factsService.getFacts(req.ownerId, 50);
            keys = facts.map((f) => f.key);
          }
          if (keys.length === 0) {
            const miKeys = await memoryItems.listKeys(req.ownerId);
            keys = miKeys.map((k) => k.key);
          } else {
            const miKeys = await memoryItems.listKeys(req.ownerId);
            const seen = new Set(keys);
            miKeys.forEach((k) => { if (!seen.has(k.key)) keys.push(k.key); });
          }
          const list = keys.length ? keys.join(', ') : '(vide)';
          return res.json({ reply: `Mémoire : ${list}`, model: null, tokens: { input: 0, output: 0 } });
        }
      } catch (e) { return next(e); }
    }

    // /reset => create new conversation, no LLM call
    if (command === 'reset') {
      const r = await db.query(
        `INSERT INTO eva.conversations (owner_id, title) VALUES ($1, $2) RETURNING id`,
        [req.ownerId, 'New conversation']
      );
      const newConvId = r.rows[0].id;
      return res.json({
        reply: 'Conversation reset. New conversation started.',
        model: null,
        tokens: { input: 0, output: 0 },
        conversation_id: newConvId,
        reset: true,
      });
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

    const msgToSend = parsedMsg || message.trim();
    if (!msgToSend) {
      return res.status(400).json({ error: 'message required after command' });
    }

    // Phase 2: Pre-answer shortcut when EVA_OVERHAUL_ENABLED (direct from facts, no LLM)
    let result;
    if (process.env.EVA_OVERHAUL_ENABLED === 'true' && req.ownerId) {
      const preAnswerService = require('../services/preAnswerService');
      const preAnswer = await preAnswerService.tryPreAnswer(req.ownerId, msgToSend);
      if (preAnswer) {
        result = { reply: preAnswer.reply, model: 'pre-answer', tokens: { input: 0, output: 0 } };
      }
    }
    if (!result) {
      result = await evaChat.reply(msgToSend, chatHistory, req.ownerId, mode, { attachedDocuments });
    }

    // Persist messages if we have a conversation
    if (convId) {
      // Save user message (original, not stripped)
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
      // Learn from conversation (async, fire-and-forget)
      const conversationLearning = require('../services/conversationLearningService');
      const historyWithNewTurn = [
        ...chatHistory,
        { role: 'user', content: message.trim() },
        { role: 'assistant', content: result.reply },
      ];
      conversationLearning.learnFromConversation(req.ownerId, historyWithNewTurn);
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

// Chat stream (SSE) — streaming response, backward compatible
router.post('/chat/stream', async (req, res, next) => {
  try {
    if (!EVA_ENABLED) return evaDisabled(res);
    const killOn = await getKillSwitch(req.ownerId);
    if (killOn) return res.status(503).json({ error: 'EVA paused (kill switch)', kill_switch: true });

    const { message, history, conversation_id, document_ids } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) required' });
    }

    let attachedDocumentsStream = [];
    if (Array.isArray(document_ids) && document_ids.length > 0 && req.ownerId) {
      const docProcessor = require('../services/documentProcessor');
      for (const docId of document_ids) {
        const id = Number(docId);
        if (!id) continue;
        const r = await db.query(
          'SELECT id, filename, content_text, status FROM eva.documents WHERE id = $1 AND owner_id = $2',
          [id, req.ownerId]
        );
        const doc = r.rows[0];
        if (!doc) continue;
        if (!doc.content_text && ['uploaded', 'processing', 'error'].includes(doc.status)) {
          try { await docProcessor.processDocument(id, req.ownerId); } catch (_) {}
          const up = await db.query('SELECT content_text FROM eva.documents WHERE id = $1', [id]);
          doc.content_text = up.rows[0]?.content_text || '';
        }
        attachedDocumentsStream.push({ id: doc.id, filename: doc.filename, content_text: doc.content_text });
      }
    }

    const parsedStream = evaChat.parseCommand(message.trim());
    const { command, message: parsedMsg, mode } = parsedStream;

    if (command === 'remember' || command === 'correct' || command === 'forget' || command === 'memory') {
      const memoryItems = require('../services/memoryItemsService');
      const useStructured = process.env.EVA_STRUCTURED_MEMORY === 'true';
      const factsService = useStructured ? require('../services/factsService') : null;
      try {
        let reply = '';
        if (command === 'remember') {
          const id = await memoryItems.addMemoryItem(req.ownerId, 'preference', parsedStream.key, parsedStream.value);
          if (useStructured && factsService) await factsService.addRemember(req.ownerId, parsedStream.key, parsedStream.value);
          reply = id ? `Noté. Préférence "${parsedStream.key}" enregistrée.` : 'Erreur.';
        } else if (command === 'correct') {
          const id = await memoryItems.addMemoryItem(req.ownerId, 'correction', parsedStream.key, parsedStream.value);
          if (useStructured && factsService) await factsService.addCorrection(req.ownerId, parsedStream.key, parsedStream.value);
          reply = id ? `Correction enregistrée : ${parsedStream.key} = ${parsedStream.value}` : 'Erreur.';
        } else if (command === 'forget') {
          let ok = await memoryItems.deleteByKey(req.ownerId, parsedStream.key);
          if (useStructured && factsService) ok = (await factsService.deleteFact(req.ownerId, parsedStream.key)) || ok;
          reply = ok ? `Oublié : ${parsedStream.key}` : `Aucune mémoire trouvée pour "${parsedStream.key}"`;
        } else if (command === 'memory') {
          let keys = [];
          if (useStructured && factsService) {
            const facts = await factsService.getFacts(req.ownerId, 50);
            keys = facts.map((f) => f.key);
          }
          if (keys.length === 0) {
            const miKeys = await memoryItems.listKeys(req.ownerId);
            keys = miKeys.map((k) => k.key);
          } else {
            const miKeys = await memoryItems.listKeys(req.ownerId);
            const seen = new Set(keys);
            miKeys.forEach((k) => { if (!seen.has(k.key)) keys.push(k.key); });
          }
          reply = keys.length ? keys.join(', ') : '(vide)';
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        res.write(`data: ${JSON.stringify({ type: 'done', reply, model: null, tokens: { input: 0, output: 0 } })}\n\n`);
        return res.end();
      } catch (e) { return next(e); }
    }

    if (command === 'reset') {
      const r = await db.query(
        `INSERT INTO eva.conversations (owner_id, title) VALUES ($1, $2) RETURNING id`,
        [req.ownerId, 'New conversation']
      );
      const newConvId = r.rows[0].id;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      res.write(`data: ${JSON.stringify({
        type: 'done',
        reply: 'Conversation reset. New conversation started.',
        conversation_id: newConvId,
        reset: true,
        model: null,
        tokens: { input: 0, output: 0 },
      })}\n\n`);
      return res.end();
    }

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

    const msgToSend = parsedMsg || message.trim();
    if (!msgToSend) {
      return res.status(400).json({ error: 'message required after command' });
    }

    // Use reply() with tools (save_memory, create_calendar_event) when ownerId — so EVA can learn. Stream has no tools.
    if (req.ownerId) {
      let result;
      if (process.env.EVA_OVERHAUL_ENABLED === 'true') {
        const preAnswerService = require('../services/preAnswerService');
        const preAnswer = await preAnswerService.tryPreAnswer(req.ownerId, msgToSend);
        if (preAnswer) result = { reply: preAnswer.reply, model: 'pre-answer', tokens: { input: 0, output: 0 } };
      }
      if (!result) result = await evaChat.reply(msgToSend, chatHistory, req.ownerId, mode, { attachedDocuments: attachedDocumentsStream });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      if (result.reply) {
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: result.reply })}\n\n`);
      }
      if (convId) {
        await db.query(
          `INSERT INTO eva.messages (conversation_id, owner_id, role, content) VALUES ($1, $2, 'user', $3)`,
          [convId, req.ownerId, message.trim()]
        );
        await db.query(
          `INSERT INTO eva.messages (conversation_id, owner_id, role, content, tokens_used) VALUES ($1, $2, 'assistant', $3, $4)`,
          [convId, req.ownerId, result.reply, (result.tokens?.input || 0) + (result.tokens?.output || 0)]
        );
        await db.query(
          `UPDATE eva.conversations SET updated_at = now(), title = COALESCE(NULLIF(title, ''), $3) WHERE id = $1 AND owner_id = $2`,
          [convId, req.ownerId, message.trim().slice(0, 100)]
        );
        const conversationLearning = require('../services/conversationLearningService');
        const historyWithNewTurn = [
          ...chatHistory,
          { role: 'user', content: message.trim() },
          { role: 'assistant', content: result.reply },
        ];
        conversationLearning.learnFromConversation(req.ownerId, historyWithNewTurn);
      }
      await db.query(
        `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'query', 'chat', $2)`,
        [req.ownerId, JSON.stringify({
          message: message.slice(0, 500),
          replyLength: result.reply?.length ?? 0,
          model: result.model,
          conversation_id: convId,
          stream: true,
          calendar_tools: true,
        })]
      );
      res.write(`data: ${JSON.stringify({
        type: 'done',
        reply: result.reply,
        model: result.model,
        tokens: result.tokens,
        conversation_id: convId,
      })}\n\n`);
      return       res.end();
    }

    const { stream, model } = await evaChat.createReplyStream(msgToSend, chatHistory, req.ownerId, mode);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
    });

    stream.on('error', (err) => {
      console.error('[EVA] stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    });

    const final = await stream.finalMessage();
    const replyText = final.content?.find((b) => b.type === 'text')?.text || '';
    const tokens = final.usage || { input_tokens: 0, output_tokens: 0 };

    if (convId) {
      await db.query(
        `INSERT INTO eva.messages (conversation_id, owner_id, role, content) VALUES ($1, $2, 'user', $3)`,
        [convId, req.ownerId, message.trim()]
      );
      await db.query(
        `INSERT INTO eva.messages (conversation_id, owner_id, role, content, tokens_used) VALUES ($1, $2, 'assistant', $3, $4)`,
        [convId, req.ownerId, replyText, (tokens.input_tokens || 0) + (tokens.output_tokens || 0)]
      );
      await db.query(
        `UPDATE eva.conversations SET updated_at = now(), title = COALESCE(NULLIF(title, ''), $3)
         WHERE id = $1 AND owner_id = $2`,
        [convId, req.ownerId, message.trim().slice(0, 100)]
      );
    }

    await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'query', 'chat', $2)`,
      [req.ownerId, JSON.stringify({
        message: message.slice(0, 500),
        replyLength: replyText.length,
        model: final.model || model,
        conversation_id: convId,
        stream: true,
      })]
    );

    res.write(`data: ${JSON.stringify({
      type: 'done',
      reply: replyText,
      model: final.model || model,
      tokens: { input: tokens.input_tokens || 0, output: tokens.output_tokens || 0 },
      conversation_id: convId,
    })}\n\n`);
    res.end();
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
    let q = 'SELECT id, channel, thread_id, subject_or_preview, body, to_emails, confidence_score, status, sent_at, created_at FROM eva.drafts WHERE owner_id = $1';
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
    const killOn = await getKillSwitch(req.ownerId);
    if (killOn) return res.status(503).json({ error: 'EVA paused (kill switch)', kill_switch: true });
    const shadowOn = await getShadowMode(req.ownerId);
    if (shadowOn) return res.status(403).json({ error: 'Drafts disabled in Shadow Mode', shadow_mode: true });

    const { channel, thread_id, subject_or_preview, body, confidence_score, to_emails } = req.body;
    if (!channel || body == null) {
      return res.status(400).json({ error: 'channel and body required' });
    }
    const autonomousOn = await getAutonomousMode(req.ownerId);
    const initialStatus = autonomousOn ? 'approved' : 'pending';
    const r = await db.query(
      `INSERT INTO eva.drafts (owner_id, channel, thread_id, subject_or_preview, body, confidence_score, status, to_emails)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, channel, thread_id, subject_or_preview, body, confidence_score, status, to_emails, created_at`,
      [req.ownerId, channel, thread_id || null, subject_or_preview || null, body, confidence_score != null ? Number(confidence_score) : null, initialStatus, to_emails || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch('/drafts/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, body } = req.body || {};
    if (status === 'sent') {
      const killOn = await getKillSwitch(req.ownerId);
      if (killOn) return res.status(503).json({ error: 'EVA paused (kill switch)', kill_switch: true });
      const shadowOn = await getShadowMode(req.ownerId);
      if (shadowOn) return res.status(403).json({ error: 'Cannot send drafts in Shadow Mode', shadow_mode: true });
    }
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

router.post('/drafts/:id/send', async (req, res, next) => {
  try {
    const killOn = await getKillSwitch(req.ownerId);
    if (killOn) return res.status(503).json({ error: 'EVA paused (kill switch)', kill_switch: true });
    const shadowOn = await getShadowMode(req.ownerId);
    if (shadowOn) return res.status(403).json({ error: 'Cannot send in Shadow Mode', shadow_mode: true });

    const r = await db.query(
      `SELECT id, channel, thread_id, subject_or_preview, body, to_emails, status
       FROM eva.drafts WHERE owner_id = $1 AND id = $2`,
      [req.ownerId, req.params.id]
    );
    const draft = r.rows[0];
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status === 'sent') return res.status(400).json({ error: 'Draft already sent' });
    if (draft.status === 'rejected') return res.status(400).json({ error: 'Cannot send rejected draft' });
    if (draft.status !== 'approved' && draft.status !== 'pending') {
      return res.status(400).json({ error: 'Draft must be approved before sending' });
    }

    const result = await gmailSend.sendDraft(req.ownerId, draft);

    await db.query(
      `UPDATE eva.drafts SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = $1`,
      [draft.id]
    );
    await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'draft_sent', $2, $3)`,
      [req.ownerId, draft.channel, JSON.stringify({ draft_id: draft.id, message_id: result.messageId, thread_id: result.threadId })]
    );

    res.json({ ok: true, message_id: result.messageId, thread_id: result.threadId });
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

// Push notifications (Web Push for browser/phone)
router.get('/push/vapid-public', (req, res) => {
  const pushService = require('../services/pushNotificationService');
  const key = pushService.getPublicKey();
  if (!key) return res.status(503).json({ error: 'Push not configured. Set EVA_VAPID_PUBLIC_KEY and EVA_VAPID_PRIVATE_KEY.' });
  res.json({ publicKey: key });
});

router.post('/push/subscribe', async (req, res, next) => {
  try {
    const { subscription } = req.body || {};
    if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription with endpoint required' });
    const pushService = require('../services/pushNotificationService');
    const userAgent = req.get('user-agent') || null;
    const id = await pushService.saveSubscription(req.ownerId, subscription, userAgent);
    res.json({ ok: true, id });
  } catch (e) {
    next(e);
  }
});

router.get('/push/status', async (req, res, next) => {
  try {
    const pushService = require('../services/pushNotificationService');
    const has = await pushService.hasSubscription(req.ownerId);
    const configured = !!pushService.getPublicKey();
    res.json({ subscribed: has, configured });
  } catch (e) {
    next(e);
  }
});

// Current location (so EVA knows "where am I")
router.get('/me/location', async (req, res, next) => {
  try {
    const memoryItems = require('../services/memoryItemsService');
    const item = await memoryItems.getByKey(req.ownerId, 'current_location');
    res.json({ location: item?.value || null });
  } catch (e) {
    next(e);
  }
});

router.put('/me/location', async (req, res, next) => {
  try {
    const { city } = req.body || {};
    const value = (typeof city === 'string' ? city : req.body?.value || '').trim();
    if (!value) return res.status(400).json({ error: 'city or value required' });
    const memoryItems = require('../services/memoryItemsService');
    await memoryItems.addMemoryItem(req.ownerId, 'preference', 'current_location', value);
    if (process.env.EVA_STRUCTURED_MEMORY === 'true') {
      try {
        const factsService = require('../services/factsService');
        await factsService.addRemember(req.ownerId, 'current_location', value);
      } catch (_) {}
    }
    res.json({ location: value });
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
      `SELECT id, source_type, external_id, config, 'active' AS status, last_sync_at, 0 AS record_count, created_at
       FROM eva.data_sources WHERE owner_id = $1 ORDER BY source_type`,
      [req.ownerId]
    );
    res.json({ sources: r.rows });
  } catch (e) {
    if (/relation .* does not exist|does not exist/i.test(String(e.message))) {
      return res.json({ sources: [] });
    }
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

// File upload: multer (FormData) or express.raw (direct binary)
// Store file_data in DB so docs survive Render ephemeral disk (deploys wipe filesystem)
const multer = require('multer');
const uploadMulter = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

async function handleDocumentUpload(req, res, next) {
  try {
    let filename, buffer;
    if (req.file) {
      filename = req.file.originalname || req.file.fieldname || `upload_${Date.now()}`;
      buffer = req.file.buffer;
    } else {
      filename = req.headers['x-filename'] || `upload_${Date.now()}`;
      buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    }
    const fileType = path.extname(filename).replace('.', '').toLowerCase() || 'unknown';
    const fileSize = buffer.length;

    const filePath = path.join(UPLOAD_DIR, `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(filePath, buffer);

    const r = await db.query(
      `INSERT INTO eva.documents (owner_id, filename, file_type, file_size, storage_path, file_data, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'uploaded') RETURNING *`,
      [req.ownerId, filename, fileType, fileSize, filePath, buffer]
    );

    // Index synchronously so user sees real status (no mock)
    const docProcessor = require('../services/documentProcessor');
    const docId = r.rows[0].id;
    try {
      await docProcessor.processDocument(docId, req.ownerId);
      console.log(`[EVA] Document ${docId} indexed`);
    } catch (e) {
      console.warn('[EVA] Document index failed:', e.message);
    }
    const updated = await db.query('SELECT id, filename, file_type, file_size, status, metadata, processed_at FROM eva.documents WHERE id = $1', [docId]);

    // Audit log
    await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'file_uploaded', 'documents', $2)`,
      [req.ownerId, JSON.stringify({ filename, fileType, fileSize })]
    );

    res.status(201).json(updated.rows[0] || r.rows[0]);
  } catch (e) {
    if (/column "file_data" does not exist|column "content_text" does not exist/i.test(String(e.message))) {
      return res.status(500).json({
        error: 'Database schema outdated. Run: psql "$DATABASE_URL" -f eva/migrations/004_add_document_file_data.sql',
        detail: e.message,
      });
    }
    next(e);
  }
}

router.post('/documents/upload', (req, res, next) => {
  const contentType = (req.get('content-type') || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    uploadMulter.single('file')(req, res, (err) => {
      if (err) return next(err);
      handleDocumentUpload(req, res, next);
    });
  } else {
    express.raw({ type: '*/*', limit: '50mb' })(req, res, (err) => {
      if (err) return next(err);
      handleDocumentUpload(req, res, next);
    });
  }
});

// Crawl website → create document (Selenium or fetch+cheerio)
// Store file_data so docs survive Render ephemeral disk
router.post('/documents/crawl', async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }
    const websiteCrawler = require('../services/websiteCrawler');
    const result = await websiteCrawler.crawlAndSave(url, UPLOAD_DIR);
    const fileData = fs.readFileSync(result.filePath, 'utf-8');

    const r = await db.query(
      `INSERT INTO eva.documents (owner_id, filename, file_type, file_size, storage_path, file_data, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', $7) RETURNING *`,
      [
        req.ownerId,
        result.filename,
        result.fileType,
        result.fileSize,
        result.filePath,
        Buffer.from(fileData, 'utf-8'),
        JSON.stringify({ source: result.source, crawl_method: result.method }),
      ]
    );

    const docProcessor = require('../services/documentProcessor');
    const docId = r.rows[0].id;
    try {
      await docProcessor.processDocument(docId, req.ownerId);
      console.log(`[EVA] Crawled document ${docId} indexed`);
    } catch (e) {
      console.warn('[EVA] Crawled document index failed:', e.message);
    }
    const updated = await db.query('SELECT id, filename, file_type, file_size, status, metadata, processed_at FROM eva.documents WHERE id = $1', [docId]);

    await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'website_crawled', 'documents', $2)`,
      [req.ownerId, JSON.stringify({ url: result.source, filename: result.filename, method: result.method })]
    );

    res.status(201).json(updated.rows[0] || r.rows[0]);
  } catch (e) {
    if (e.message?.includes('not allowed') || e.message?.includes('not found')) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

// Delete a document
router.delete('/documents/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await db.query('DELETE FROM eva.documents WHERE id = $1 AND owner_id = $2 RETURNING id', [id, req.ownerId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Document not found' });
    await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'document_deleted', 'documents', $2)`,
      [req.ownerId, JSON.stringify({ document_id: id })]
    );
    res.json({ deleted: true });
  } catch (e) {
    next(e);
  }
});

// Stream original file (PDF, image) for viewing
router.get('/documents/:id/file', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await db.query(
      'SELECT id, filename, file_type, file_data FROM eva.documents WHERE id = $1 AND owner_id = $2',
      [id, req.ownerId]
    );
    const doc = r.rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.file_data || (Buffer.isBuffer(doc.file_data) && doc.file_data.length === 0)) {
      return res.status(404).json({ error: 'File data not available' });
    }
    const buf = Buffer.isBuffer(doc.file_data) ? doc.file_data : Buffer.from(doc.file_data);
    const ft = (doc.file_type || '').toLowerCase();
    const ctype = ft === 'pdf' ? 'application/pdf' : ['jpg', 'jpeg'].includes(ft) ? 'image/jpeg' : ft === 'png' ? 'image/png' : ft === 'gif' ? 'image/gif' : ft === 'webp' ? 'image/webp' : 'application/octet-stream';
    res.setHeader('Content-Type', ctype);
    res.setHeader('Content-Disposition', `inline; filename="${(doc.filename || 'document').replace(/"/g, '%22')}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

// Get indexed content of a document (extracted text)
router.get('/documents/:id/content', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await db.query(
      'SELECT id, filename, content_text, status, processed_at FROM eva.documents WHERE id = $1 AND owner_id = $2',
      [id, req.ownerId]
    );
    const doc = r.rows[0];
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (doc.status !== 'indexed' || !doc.content_text) {
      return res.status(400).json({ error: 'Document not indexed yet', status: doc.status });
    }
    res.json({ id: doc.id, filename: doc.filename, content_text: doc.content_text, processed_at: doc.processed_at });
  } catch (e) {
    next(e);
  }
});

// Re-index all documents for owner (upgrade to AI extraction)
// Runs async to avoid 502 timeout — processing many docs can take minutes
router.post('/documents/reindex', async (req, res, next) => {
  try {
    const docProcessor = require('../services/documentProcessor');
    const ownerId = req.ownerId;
    const countResult = await db.query('SELECT COUNT(*) AS n FROM eva.documents WHERE owner_id = $1', [ownerId]);
    const total = parseInt(countResult.rows[0]?.n || 0, 10);
    const eta = total > 0 ? ` (~${Math.ceil(total * 15 / 60)} min for ${total} doc${total > 1 ? 's' : ''})` : '';
    const message = total > 0
      ? `Re-indexing ${total} document${total > 1 ? 's' : ''} in background. Each takes ~10–30 s.${eta} Refresh the list when done.`
      : 'No documents to re-index.';
    res.status(202).json({ status: 'started', message, total });
    if (total > 0) {
      setImmediate(async () => {
        try {
          const result = await docProcessor.reindexAllDocuments(ownerId);
          console.log(`[EVA] Reindex completed for owner ${ownerId}:`, result);
        } catch (e) {
          console.error('[EVA] Reindex failed:', e.message);
        }
      });
    }
  } catch (e) {
    next(e);
  }
});

// Reprocess document (extract text for search)
router.post('/documents/:id/process', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const docProcessor = require('../services/documentProcessor');
    await docProcessor.processDocument(id, req.ownerId);
    const r = await db.query('SELECT id, filename, status, processed_at FROM eva.documents WHERE id = $1 AND owner_id = $2', [id, req.ownerId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Document not found' });
    res.json(r.rows[0]);
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
// GMAIL OAUTH2 & EMAIL INTEGRATION (Phase 2)
// ════════════════════════════════════════════════════════════════

// Start OAuth flow — returns Google consent URL
router.get('/oauth/gmail/start', async (req, res, next) => {
  try {
    const authUrl = googleOAuth.getAuthUrl(String(req.ownerId));
    res.json({ auth_url: authUrl });
  } catch (e) {
    next(e);
  }
});

// OAuth callback → routes/oauth.js (public; Google redirects with code+state)
// REMOVED: callback now in routes/oauth.js

// List connected Gmail accounts
router.get('/gmail/accounts', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT id, gmail_address, sync_status, full_sync_complete, last_sync_at, error_message, created_at
       FROM eva.gmail_accounts WHERE owner_id = $1 ORDER BY created_at DESC`,
      [req.ownerId]
    );
    res.json({ accounts: r.rows });
  } catch (e) {
    if (/relation "eva\.gmail_accounts" does not exist|does not exist/i.test(String(e.message))) {
      return res.json({ accounts: [] });
    }
    next(e);
  }
});

// Trigger manual sync for a Gmail account
router.post('/gmail/sync/:id', async (req, res, next) => {
  try {
    const accountId = Number(req.params.id);
    // Run sync (async — don't block response for too long)
    const result = await gmailSync.syncEmails(req.ownerId, accountId);
    res.json({ status: 'synced', ...result });
  } catch (e) {
    next(e);
  }
});

// Disconnect a Gmail account
router.delete('/gmail/accounts/:id', async (req, res, next) => {
  try {
    const accountId = Number(req.params.id);
    // Get token to revoke
    const acct = await db.query(
      'SELECT access_token, gmail_address FROM eva.gmail_accounts WHERE id = $1 AND owner_id = $2',
      [accountId, req.ownerId]
    );
    if (acct.rows[0]) {
      await googleOAuth.revokeToken(acct.rows[0].access_token);
      // Delete account (cascades to emails via FK)
      await db.query('DELETE FROM eva.gmail_accounts WHERE id = $1 AND owner_id = $2', [accountId, req.ownerId]);
      // Remove from data_sources
      await db.query(
        `DELETE FROM eva.data_sources WHERE owner_id = $1 AND source_type = 'gmail' AND external_id = $2`,
        [req.ownerId, acct.rows[0].gmail_address]
      );
      // Audit
      await db.query(
        `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'gmail_disconnected', 'gmail', $2)`,
        [req.ownerId, JSON.stringify({ gmail_address: acct.rows[0].gmail_address })]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// List/search synced emails
router.get('/gmail/emails', async (req, res, next) => {
  try {
    const { q, limit = 50, offset = 0, from, after, before, gmail_account_id, folder } = req.query;

    // Full-text search (also respects folder)
    if (q && q.trim().length > 0) {
      try {
        const emails = await gmailSync.searchEmails(req.ownerId, q, Math.min(Number(limit), 100), gmail_account_id ? parseInt(gmail_account_id, 10) : null, folder);
        return res.json({ emails, total: emails.length });
      } catch (err) {
        if (/relation "eva\.emails" does not exist|does not exist/i.test(String(err.message))) {
          return res.json({ emails: [], total: 0 });
        }
        throw err;
      }
    }

    // Folder filter: inbox | sent | draft | all (Outlook-style). labels is TEXT[] in schema.
    const folderLabel = folder === 'sent' ? 'SENT' : folder === 'draft' ? 'DRAFT' : folder === 'all' ? null : 'INBOX';
    const labelCondition = folderLabel
      ? ` AND labels @> ARRAY['${folderLabel}']::text[]`
      : '';

    // Default: list recent emails with optional filters
    const selectCols = 'id, gmail_account_id, from_email, from_name, to_emails, subject, snippet, received_at, labels, is_read, is_starred, has_attachments';
    let query = `SELECT ${selectCols} FROM eva.emails WHERE owner_id = $1${labelCondition}`;
    const params = [req.ownerId];
    let paramIdx = 2;

    if (gmail_account_id) {
      query += ` AND gmail_account_id = $${paramIdx}`;
      params.push(parseInt(gmail_account_id, 10));
      paramIdx++;
    }
    if (from) {
      query += ` AND from_email ILIKE $${paramIdx}`;
      params.push(`%${from}%`);
      paramIdx++;
    }
    if (after) {
      query += ` AND received_at >= $${paramIdx}`;
      params.push(after);
      paramIdx++;
    }
    if (before) {
      query += ` AND received_at <= $${paramIdx}`;
      params.push(before);
      paramIdx++;
    }

    const countParams = params.slice();
    let countQuery = `SELECT count(*) as cnt FROM eva.emails WHERE owner_id = $1${labelCondition}`;
    let countIdx = 2;
    if (gmail_account_id) { countQuery += ` AND gmail_account_id = $${countIdx}`; countIdx++; }
    if (from) { countQuery += ` AND from_email ILIKE $${countIdx}`; countIdx++; }
    if (after) { countQuery += ` AND received_at >= $${countIdx}`; countIdx++; }
    if (before) { countQuery += ` AND received_at <= $${countIdx}`; countIdx++; }

    query += ` ORDER BY received_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(Math.min(Number(limit) || 50, 100), Number(offset) || 0);

    const r = await db.query(query, params);
    const countResult = await db.query(countQuery, countParams);

    res.json({ emails: r.rows, total: Number(countResult.rows[0].cnt) });
  } catch (e) {
    if (/relation "eva\.(emails|gmail_accounts)" does not exist|does not exist/i.test(String(e.message))) {
      return res.json({ emails: [], total: 0 });
    }
    console.error('[EVA /gmail/emails]', e.message);
    next(e);
  }
});

// ════════════════════════════════════════════════════════════════
// CALENDAR (Google Calendar via same OAuth as Gmail)
// ════════════════════════════════════════════════════════════════

// Sync calendar for all connected Gmail accounts
router.post('/calendar/sync', async (req, res, next) => {
  try {
    const result = await calendarSync.syncCalendarForAllAccounts(req.ownerId);
    res.json({ status: 'synced', synced: result.synced, accounts: result.accounts, errors: result.errors });
  } catch (e) {
    next(e);
  }
});

// List calendar events (optional gmail_account_id, from, to for date range)
router.get('/calendar/events', async (req, res, next) => {
  try {
    const { limit = 100, days = 60, gmail_account_id, from, to } = req.query;
    const gmailAccountId = gmail_account_id ? parseInt(gmail_account_id, 10) : null;
    const events = await calendarSync.getUpcomingEvents(
      req.ownerId,
      Math.min(Number(limit) || 100, 200),
      Math.min(Number(days) || 60, 90),
      gmailAccountId,
      from || null,
      to || null
    );
    res.json({ events });
  } catch (e) {
    if (/relation "eva\.calendar_events" does not exist/i.test(String(e.message))) {
      return res.json({ events: [] });
    }
    next(e);
  }
});

// Get single email detail
router.get('/gmail/emails/:id', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT e.*, array_agg(json_build_object('filename', a.filename, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes))
              FILTER (WHERE a.id IS NOT NULL) as attachments
       FROM eva.emails e
       LEFT JOIN eva.email_attachments a ON a.email_id = e.id
       WHERE e.id = $1 AND e.owner_id = $2
       GROUP BY e.id`,
      [req.params.id, req.ownerId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Email not found' });
    res.json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// ════════════════════════════════════════════════════════════════
// STATS (dashboard metrics)
// ════════════════════════════════════════════════════════════════
router.get('/stats', async (req, res, next) => {
  try {
    const [convos, msgs, draftsR, logsR, docsR, emailsR, gmailR, calendarR] = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM eva.conversations WHERE owner_id = $1', [req.ownerId]),
      db.query('SELECT COUNT(*) AS count FROM eva.messages WHERE owner_id = $1', [req.ownerId]),
      db.query(`SELECT status, COUNT(*) AS count FROM eva.drafts WHERE owner_id = $1 GROUP BY status`, [req.ownerId]),
      db.query(`SELECT COUNT(*) AS count FROM eva.audit_logs WHERE owner_id = $1 AND created_at > now() - interval '7 days'`, [req.ownerId]),
      db.query('SELECT COUNT(*) AS count, COALESCE(SUM(file_size), 0) AS total_size FROM eva.documents WHERE owner_id = $1', [req.ownerId]),
      db.query('SELECT COUNT(*) AS count FROM eva.emails WHERE owner_id = $1', [req.ownerId]).catch(() => ({ rows: [{ count: 0 }] })),
      db.query('SELECT COUNT(*) AS count FROM eva.gmail_accounts WHERE owner_id = $1', [req.ownerId]).catch(() => ({ rows: [{ count: 0 }] })),
      db.query('SELECT COUNT(*) AS count FROM eva.calendar_events WHERE owner_id = $1', [req.ownerId]).catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    const draftsByStatus = {};
    (draftsR.rows || []).forEach((r) => { draftsByStatus[r.status] = Number(r.count); });

    const docs = Number(docsR.rows[0]?.count || 0);
    const emails = Number(emailsR.rows[0]?.count || 0);
    const gmailAccounts = Number(gmailR.rows[0]?.count || 0);
    const calendarEvents = Number(calendarR.rows[0]?.count || 0);
    const totalDrafts = Object.values(draftsByStatus).reduce((a, b) => a + b, 0);
    const realtimeEnabled = !!(process.env.OPENAI_API_KEY || '').trim();

    const [styleProfileText, autonomousOn] = await Promise.all([
      getStyleProfile(req.ownerId),
      getAutonomousMode(req.ownerId),
    ]);
    const hasStyleProfile = !!(styleProfileText && styleProfileText.length > 0);

    const hasMemoryVaultData = docs > 0 || emails > 0 || calendarEvents > 0;
    const hasMemoryVault = hasMemoryVaultData || gmailAccounts > 0;
    const hasVoice = realtimeEnabled;
    const hasDrafts = totalDrafts > 0;

    const phases = [
      {
        phase: 1,
        label: 'Memory Vault',
        desc: 'Archive & indexing',
        status: hasMemoryVault ? 'live' : 'building',
        pct: hasMemoryVaultData ? 100 : (gmailAccounts > 0 ? 50 : 20),
      },
      {
        phase: 2,
        label: 'Voice + Shadow',
        desc: 'Real-time voice + observation',
        status: hasVoice ? 'live' : 'planned',
        pct: hasVoice ? 100 : 0,
      },
      {
        phase: 3,
        label: 'Limited Proxy',
        desc: 'Approve-before-send',
        status: hasDrafts ? 'live' : 'building',
        pct: hasDrafts ? 80 : 40,
      },
      {
        phase: 4,
        label: 'Fine-Tuned Model',
        desc: 'Your voice, your style',
        status: hasStyleProfile ? 'live' : 'building',
        pct: hasStyleProfile ? 100 : (hasDrafts ? 30 : 0),
      },
      {
        phase: 5,
        label: 'Autonomous Proxy',
        desc: 'Full delegation',
        status: autonomousOn ? 'live' : 'planned',
        pct: autonomousOn ? 100 : 0,
      },
    ];

    res.json({
      conversations: Number(convos.rows[0]?.count || 0),
      messages: Number(msgs.rows[0]?.count || 0),
      drafts: draftsByStatus,
      audit_logs_7d: Number(logsR.rows[0]?.count || 0),
      documents: docs,
      documents_size: Number(docsR.rows[0]?.total_size || 0),
      emails,
      phases,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
