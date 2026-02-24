/**
 * OpenAI Realtime API — token endpoint for WebRTC voice (ChatGPT-level fluid conversation).
 * Returns ephemeral client secret so the frontend connects directly to OpenAI.
 * Injects recent email context into instructions so EVA can answer email questions via voice.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');

const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const REALTIME_ENABLED = !!OPENAI_KEY;
const DEFAULT_OWNER_EMAIL = process.env.EVA_OWNER_EMAIL || 'loic@halisoft.biz';

const EVA_INSTRUCTIONS_BASE = `You are EVA, personal assistant (HaliSoft, Dubai). Keep answers short and direct. Professional but warm style.

LANGUAGE: Always reply in the SAME language the user speaks. If they speak French, reply in French. If they speak English, reply in English. Match their language automatically.

DATA ACCESS: You have access to everything injected below (emails + documents). Use this data to answer any question. No camera or calendar.

STOP: If the user says "stop", "arrête", "assez", "stop talking" — reply ONLY "OK" or "D'accord" in a very short phrase then STOP. Do not continue.`;

async function buildInstructionsWithContext(ownerId) {
  let instructions = EVA_INSTRUCTIONS_BASE;
  try {
    const owner = ownerId
      ? (await db.query('SELECT id FROM eva.owners WHERE id = $1', [ownerId])).rows[0]
      : await db.getOrCreateOwner(DEFAULT_OWNER_EMAIL, 'Loic Hennocq');
    if (!owner) return instructions;

    // Optional: force language from settings (auto = match user)
    const langRow = await db.query('SELECT value FROM eva.settings WHERE owner_id = $1 AND key = $2', [owner.id, 'chat_language']);
    const chatLang = langRow.rows[0]?.value?.lang || 'auto';
    if (chatLang === 'fr') {
      instructions = 'CRITICAL: Reply ONLY in French.\n\n' + instructions;
    } else if (chatLang === 'en') {
      instructions = 'CRITICAL: Reply ONLY in English.\n\n' + instructions;
    }
    // chatLang === 'auto' -> no override, match user language

    // Emails — recent
    let gmailSync = null;
    try {
      gmailSync = require('../services/gmailSync');
    } catch (_) {}
    if (gmailSync?.getRecentEmails) {
      const recent = await gmailSync.getRecentEmails(owner.id, 30);
      if (recent.length > 0) {
        console.log(`[EVA Realtime] Injected ${recent.length} emails`);
        instructions += '\n\n## EMAILS (full access)\n';
        recent.forEach((e) => {
          const date = new Date(e.received_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
          const snippet = (e.snippet || '').slice(0, 300);
          const body = ((e.body_preview || '').replace(/\s+/g, ' ').trim()).slice(0, 400);
          const extra = body ? ` | ${body}` : (snippet ? ` | ${snippet}` : '');
          instructions += `• ${e.from_name || e.from_email}: "${(e.subject || '').slice(0, 100)}" (${date})${extra}\n`;
        });
      }
    }

    // Documents — tous les indexés
    let docProcessor = null;
    try {
      docProcessor = require('../services/documentProcessor');
    } catch (_) {}
    if (docProcessor?.getRecentDocuments) {
      const docs = await docProcessor.getRecentDocuments(owner.id, 10);
      if (docs.length > 0) {
        console.log(`[EVA Realtime] Injected ${docs.length} documents`);
        instructions += '\n\n## UPLOADED DOCUMENTS (full access)\n';
        docs.forEach((d) => {
          instructions += `**${d.filename}:**\n${(d.content_text || '').slice(0, 1200)}\n\n`;
        });
        instructions += 'Use these documents for flights, tickets, Shanghai, meetings, etc.';
      }
    }
  } catch (err) {
    console.warn('[EVA Realtime] Context injection failed:', err.message);
  }
  return instructions;
}

router.get('/token', async (req, res, next) => {
  try {
    if (!REALTIME_ENABLED) {
      return res.status(503).json({ error: 'Realtime API disabled. Set OPENAI_API_KEY.' });
    }
    const instructions = await buildInstructionsWithContext(req.ownerId);

    const sessionConfig = {
      session: {
        type: 'realtime',
        model: 'gpt-realtime',
        instructions,
        audio: { output: { voice: 'marin' } },
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionConfig),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      console.error('[EVA Realtime] token error:', response.status, err);
      return res.status(response.status).json({ error: err || 'Failed to get token' });
    }

    const data = await response.json();
    res.json(data);
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'OpenAI timeout. Retry.' });
    }
    console.error('[EVA Realtime]', e.message);
    next(e);
  }
});

router.get('/status', (req, res) => {
  res.json({ enabled: REALTIME_ENABLED });
});

module.exports = router;
