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

const EVA_INSTRUCTIONS_BASE = `# EVA — Voice Assistant (HaliSoft, Dubai)

## CRITICAL: How to Answer
1. **Parse the question**: What is the user asking? (person, topic, date, action)
2. **Search the data below**: Emails and documents are YOUR SOURCE. Match names, subjects, dates.
3. **If found** → Give the specific answer. "Pierre t'a écrit le 12 février : [résumé]". Be concrete.
4. **If not found** → Say "Je n'ai pas cette info" or "I don't have that". Never invent.
5. **Never** vague answers. Never "I understand" or "Je comprends" as opener — go straight to the answer.

## Voice Style
- SHORT spoken answers. 1–3 sentences max. No long monologues.
- French user → French reply. English user → English reply. Always match.
- Professional, warm, direct.

## Data Access
- Emails and documents are injected below. USE THEM to answer. If asked about messages, people, travel, flights — search the data.
- No camera, no calendar. If you lack info, say so.

## Silence / Filler
- If the user says nothing meaningful (silence, "euh", "hmm", "ah") — do NOT respond. Stay silent.

## Stop
- "Stop", "arrête", "assez" → reply ONLY "OK" or "D'accord" then stop.`;

async function buildInstructionsWithContext(ownerId) {
  let instructions = EVA_INSTRUCTIONS_BASE;
  let transcriptionLang = null;
  let turnEagerness = 'low';

  try {
    const owner = ownerId
      ? (await db.query('SELECT id FROM eva.owners WHERE id = $1', [ownerId])).rows[0]
      : await db.getOrCreateOwner(DEFAULT_OWNER_EMAIL, 'Loic Hennocq');
    if (!owner) return { instructions, transcriptionLang, turnEagerness };

    const langRow = await db.query('SELECT value FROM eva.settings WHERE owner_id = $1 AND key = $2', [owner.id, 'chat_language']);
    const chatLang = langRow.rows[0]?.value?.lang || 'auto';

    if (chatLang === 'fr') {
      instructions = 'CRITICAL: Reply ONLY in French.\n\n' + instructions;
      transcriptionLang = 'fr';
    } else if (chatLang === 'en') {
      instructions = 'CRITICAL: Reply ONLY in English.\n\n' + instructions;
      transcriptionLang = 'en';
    } else {
      transcriptionLang = 'fr';
    }

    // Emails — recent, structured for quick scanning
    let gmailSync = null;
    try {
      gmailSync = require('../services/gmailSync');
    } catch (_) {}
    if (gmailSync?.getRecentEmails) {
      const recent = await gmailSync.getRecentEmails(owner.id, 25);
      if (recent.length > 0) {
        console.log(`[EVA Realtime] Injected ${recent.length} emails`);
        instructions += '\n\n---\n## EMAILS (use to answer questions about messages, people, dates)\n\n';
        recent.forEach((e, i) => {
          const date = new Date(e.received_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
          const from = e.from_name || e.from_email;
          const body = ((e.body_preview || e.snippet || '').replace(/\s+/g, ' ').trim()).slice(0, 600);
          instructions += `[Email ${i + 1}] FROM: ${from} | SUBJECT: ${(e.subject || '').slice(0, 80)} | DATE: ${date}\nBODY: ${body}\n\n`;
        });
      }
    }

    // Documents — indexed content (flights, tickets, travel)
    let docProcessor = null;
    try {
      docProcessor = require('../services/documentProcessor');
    } catch (_) {}
    if (docProcessor?.getRecentDocuments) {
      const docs = await docProcessor.getRecentDocuments(owner.id, 8);
      if (docs.length > 0) {
        console.log(`[EVA Realtime] Injected ${docs.length} documents`);
        instructions += '\n---\n## DOCUMENTS (flights, tickets, Shanghai, travel, meetings)\n\n';
        docs.forEach((d, i) => {
          instructions += `[Doc ${i + 1}] ${d.filename}:\n${(d.content_text || '').slice(0, 1500)}\n\n`;
        });
      }
    }
  } catch (err) {
    console.warn('[EVA Realtime] Context injection failed:', err.message);
  }
  return { instructions, transcriptionLang, turnEagerness };
}

router.get('/token', async (req, res, next) => {
  try {
    if (!REALTIME_ENABLED) {
      return res.status(503).json({ error: 'Realtime API disabled. Set OPENAI_API_KEY.' });
    }
    const { instructions, transcriptionLang, turnEagerness } = await buildInstructionsWithContext(req.ownerId);

    const model = process.env.EVA_REALTIME_MODEL || 'gpt-4o-realtime-preview';

    const sessionConfig = {
      session: {
        type: 'realtime',
        model,
        instructions,
        max_output_tokens: 1024,
        audio: {
          input: {
            transcription: transcriptionLang ? {
              model: 'gpt-4o-transcribe',
              language: transcriptionLang,
            } : undefined,
            turn_detection: {
              type: 'semantic_vad',
              create_response: true,
              interrupt_response: true,
              eagerness: turnEagerness || 'low',
            },
          },
          output: { voice: 'marin' },
        },
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
