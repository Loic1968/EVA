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

VISION vs DONNÉES: Tu n'as pas de caméra ni d'écran (pas de slides, PDF, présentation). MAIS tu peux avoir accès à des DONNÉES en texte (emails, etc.) injectées dans tes instructions. Si on te fournit une liste d'emails ci-dessous, tu DOIS les utiliser et les résumer quand Loic demande "mes emails". Ne dis jamais "je ne peux pas voir tes emails" si la liste est fournie. Tu n'as pas accès au calendrier.`;

async function buildInstructionsWithEmailContext() {
  let instructions = EVA_INSTRUCTIONS_BASE;
  try {
    const owner = await db.getOrCreateOwner(DEFAULT_OWNER_EMAIL, 'Loic Hennocq');
    let gmailSync = null;
    try {
      gmailSync = require('../services/gmailSync');
    } catch (_) {}
    if (gmailSync && gmailSync.getRecentEmails) {
      const recent = await gmailSync.getRecentEmails(owner.id, 8);
      if (recent.length > 0) {
        console.log(`[EVA Realtime] Injected ${recent.length} emails into session`);
        instructions += '\n\n## EMAILS DE LOIC (Memory Vault) — TU AS ACCÈS À CECI\n';
        instructions += 'Quand Loic demande ses emails, "mes derniers emails", etc., réponds en résumant cette liste:\n\n';
        recent.forEach((e) => {
          const date = new Date(e.received_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
          instructions += `• De ${e.from_name || e.from_email} — ${(e.subject || '').slice(0, 70)} (${date})\n  ${(e.snippet || '').slice(0, 100)}\n`;
        });
        instructions += '\nRègle: Ne dis JAMAIS que tu n\'as pas accès aux emails quand cette liste est fournie.';
      } else {
        instructions += '\n\n( Pas d\'emails synchronisés. Si Loic demande ses emails, dis-lui de connecter Gmail dans Data Sources.)';
        console.log('[EVA Realtime] No emails in DB, skipped injection');
      }
    }
  } catch (err) {
    console.warn('[EVA Realtime] Email context injection failed:', err.message);
  }
  return instructions;
}

router.get('/token', async (req, res, next) => {
  try {
    if (!REALTIME_ENABLED) {
      return res.status(503).json({ error: 'Realtime API disabled. Set OPENAI_API_KEY.' });
    }

    const instructions = await buildInstructionsWithEmailContext();

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
