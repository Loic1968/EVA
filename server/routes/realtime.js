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

const EVA_INSTRUCTIONS_BASE = `Tu es EVA, assistant personnel de Loic (HaliSoft, Dubai). Réponses courtes et directes. Parle en français ou anglais selon la langue de l'utilisateur. Style professionnel mais chaleureux.

ACCÈS AUX DONNÉES: Tu as accès à TOUT ce qui est injecté ci-dessous (emails + documents). Utilise ces données pour répondre à toute question de Loic. Pas de caméra ni calendrier.

STOP: Si Loic dit "stop", "arrête", "assez", "stop talking" — réponds UNIQUEMENT "OK" ou "D'accord" en une toute courte phrase puis TAIRE. Ne continue pas.`;

async function buildInstructionsWithContext(ownerId) {
  let instructions = EVA_INSTRUCTIONS_BASE;
  try {
    const owner = ownerId
      ? (await db.query('SELECT id FROM eva.owners WHERE id = $1', [ownerId])).rows[0]
      : await db.getOrCreateOwner(DEFAULT_OWNER_EMAIL, 'Loic Hennocq');
    if (!owner) return instructions;

    // Emails — tous les récents
    let gmailSync = null;
    try {
      gmailSync = require('../services/gmailSync');
    } catch (_) {}
    if (gmailSync?.getRecentEmails) {
      const recent = await gmailSync.getRecentEmails(owner.id, 30);
      if (recent.length > 0) {
        console.log(`[EVA Realtime] Injected ${recent.length} emails`);
        instructions += '\n\n## EMAILS (accès complet)\n';
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
        instructions += '\n\n## DOCUMENTS UPLOADÉS (accès complet)\n';
        docs.forEach((d) => {
          instructions += `**${d.filename}:**\n${(d.content_text || '').slice(0, 1200)}\n\n`;
        });
        instructions += 'Utilise ces documents pour vol, billet, Shanghai, rendez-vous, etc.';
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
