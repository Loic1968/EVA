/**
 * OpenAI Realtime API — token endpoint for WebRTC voice (ChatGPT-level fluid conversation).
 * Returns ephemeral client secret so the frontend connects directly to OpenAI.
 * Injects recent email context into instructions so EVA can answer email questions via voice.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const { getKillSwitch } = require('../services/settingsService');

const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const REALTIME_ENABLED = !!OPENAI_KEY;
const DEFAULT_OWNER_EMAIL = process.env.EVA_OWNER_EMAIL || 'loic@halisoft.biz';

const { getCanonicalPrompt } = require('../prompts/canonicalPrompt');
const EVA_INSTRUCTIONS_LEGACY = `# EVA — Voice Assistant (HaliSoft)

## RULE #1: ONLY respond to CLEAR questions or requests
- Respond ONLY when the user explicitly ASKS A QUESTION or MAKES A REQUEST.
- Noise, silence, breathing, "euh", "hmm", "ah", coughing — DO NOT RESPOND. Stay completely silent.
- NEVER say "j'ai compris", "oui", "d'accord" as a response to nothing. Never invent questions.
- If unsure (short/ambiguous message, possible noise) → stay silent. Do not guess.

## Check-in
- "Tu m'entends?", "Tu m'écoutes?", "Are you there?" → "Oui" or "Oui, je t'entends." Only. Nothing else.

## Your Name
- "Comment tu t'appelles?" / "What's your name?" / "Qui es-tu?" → "EVA". Short only.

## Complete answers (critical)
- One clear, complete sentence. Never trail off with "Et vraiment...", "Il parlait de...", "Apparemment...". No truncated phrases. No "Bravo!" alone.

## How to Answer
1. Parse: What is the user asking? (person, topic, date, action)
2. Search: Emails, documents, calendar below. Match names, subjects, dates.
3. Found → Give the specific answer. Be concrete.
4. Not found → "Je n'ai pas cette info". Never invent.
5. Never vague. Never "I understand" as opener — go straight to the answer.

## Documents (billets, factures)
- Use EXACT dates from the document. 2 mars ≠ 1 mars.
- Documents = for ANSWERING. Never "je note que tu mesures X" from a document.

## Corrections
- "C'est faux", "non c'est le 2 mars" → "D'accord, je note : [their version]." Never insist.

## Voice Style
- 1–3 sentences max. French user → French. English → English.
- Professional, direct.

## Data & Memories
- Use ## Emails, ## Documents, ## Calendar below to answer.
- Fact to remember → "Note-le en chat pour que je le retienne."

## Stop
- "Stop", "arrête" → "OK" then stop.`;

const EVA_INSTRUCTIONS_BASE = process.env.EVA_OVERHAUL_ENABLED === 'true'
  ? getCanonicalPrompt('voice')
  : EVA_INSTRUCTIONS_LEGACY;

async function buildInstructionsWithContext(ownerId) {
  const SILENCE_RULE = 'STRICT: Réponds UNIQUEMENT aux questions/demandes claires. Bruit, "euh", silence → NE RÉPONDS PAS.\n\n';
  let instructions = SILENCE_RULE + EVA_INSTRUCTIONS_BASE;
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

    // Memories — memory_items + feedback + legacy (Voice can read, cannot save — use Chat to add)
    try {
      const memoryItems = require('../services/memoryItemsService');
      const feedbackService = require('../services/feedbackService');
      const memoryService = require('../services/memoryService');
      const [items, feedback, legacy] = await Promise.all([
        memoryItems.getMemoryItems(owner.id, 25),
        feedbackService.getRecentFeedback(owner.id, 8),
        memoryService.getMemories(owner.id, 10),
      ]);
      if (items.length > 0 || feedback.length > 0 || legacy.length > 0) {
        instructions += '\n---\n## MEMORIES (corrections > preferences > facts — use these)\n\n';
        items.forEach((m) => { instructions += `- [${m.kind}] ${m.key} = ${m.value}\n`; });
        feedback.filter((f) => f.feedback_type === 'correction' && f.corrected_text).forEach((f) => {
          instructions += `- Éviter: "${(f.original_text || '').slice(0, 50)}..." → Utiliser: "${(f.corrected_text || '').slice(0, 50)}..."\n`;
        });
        if (legacy.length > 0 && items.length < 3) legacy.slice(0, 5).forEach((m) => { instructions += `- ${m.fact}\n`; });
      }
    } catch (_) {}

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
          const isSent = Array.isArray(e.labels) ? e.labels.includes('SENT') : (e.labels && /"SENT"|'SENT'/.test(String(e.labels)));
          const who = isSent ? `TO: ${Array.isArray(e.to_emails) ? e.to_emails.join(', ') : e.to_emails || '—'}` : `FROM: ${e.from_name || e.from_email}`;
          const body = ((e.body_preview || e.snippet || '').replace(/\s+/g, ' ').trim()).slice(0, 600);
          instructions += `[Email ${i + 1}] ${who} | SUBJECT: ${(e.subject || '').slice(0, 80)} | DATE: ${date}\nBODY: ${body}\n\n`;
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
        instructions += '\n---\n## DOCUMENTS (flights, tickets, Shanghai, travel) — use EXACT dates from text (e.g. 2 mars = 2 mars, never 1 mars)\n\n';
        docs.forEach((d, i) => {
          instructions += `[Doc ${i + 1}] ${d.filename}:\n${(d.content_text || '').slice(0, 6000)}\n\n`;
        });
      }
    }

    // Calendar — upcoming events
    let calendarSync = null;
    try {
      calendarSync = require('../services/calendarSync');
    } catch (_) {}
    if (calendarSync?.getUpcomingEvents) {
      const events = await calendarSync.getUpcomingEvents(owner.id, 12, 14);
      if (events.length > 0) {
        console.log(`[EVA Realtime] Injected ${events.length} calendar events`);
        instructions += '\n---\n## CALENDAR (upcoming meetings, schedule)\n\n';
        events.forEach((ev, i) => {
          const start = new Date(ev.start_at);
          const fmt = ev.is_all_day
            ? start.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
            : start.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          instructions += `[Event ${i + 1}] ${ev.title || '(no title)'} | ${fmt}${ev.location ? ` @ ${ev.location}` : ''}${ev.gmail_address ? ` [${ev.gmail_address}]` : ''}\n`;
        });
      }
    }
  } catch (err) {
    console.warn('[EVA Realtime] Context injection failed:', err.message);
  }
  return { instructions, transcriptionLang, turnEagerness };
}

router.get('/token', async (req, res) => {
  try {
    if (!REALTIME_ENABLED) {
      return res.status(503).json({ error: 'Realtime API disabled. Set OPENAI_API_KEY.' });
    }
    const killOn = await getKillSwitch(req.ownerId);
    if (killOn) return res.status(503).json({ error: 'EVA paused (kill switch)', kill_switch: true });
    // Voice allowed in Shadow Mode — only drafts are restricted

    let instructions, transcriptionLang, turnEagerness;
    try {
      const ctx = await buildInstructionsWithContext(req.ownerId);
      instructions = ctx.instructions;
      transcriptionLang = ctx.transcriptionLang;
      turnEagerness = ctx.turnEagerness;
    } catch (ctxErr) {
      console.warn('[EVA Realtime] buildInstructions failed, using fallback:', ctxErr.message);
      instructions = EVA_INSTRUCTIONS_BASE;
      transcriptionLang = 'fr';
      turnEagerness = 'low';
    }

    const model = process.env.EVA_REALTIME_MODEL || 'gpt-realtime';

    const sessionConfig = {
      session: {
        type: 'realtime',
        model,
        instructions,
        max_output_tokens: 256,
        audio: {
          input: {
            transcription: transcriptionLang ? {
              model: 'gpt-4o-transcribe',
              language: transcriptionLang,
            } : undefined,
            noise_reduction: { type: 'near_field' },
            turn_detection: {
              type: 'server_vad',
              create_response: true,
              interrupt_response: true,
              threshold: 0.5,
              silence_duration_ms: 500,
              prefix_padding_ms: 300,
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
    // Handle OpenAI error payload in 200 response (e.g. quota, invalid key)
    if (data?.error) {
      const msg = data.error?.message || data.error?.code || JSON.stringify(data.error);
      console.error('[EVA Realtime] OpenAI error in response:', msg);
      return res.status(500).json({ error: msg || 'OpenAI rejected token request' });
    }
    // Frontend expects { value, model }. OpenAI returns { client_secret: { value }, ... }
    const ephemeralKey = data?.client_secret?.value ?? data?.client_secret ?? data?.value;
    if (!ephemeralKey || typeof ephemeralKey !== 'string') {
      console.error('[EVA Realtime] No client_secret.value in OpenAI response:', JSON.stringify(data).slice(0, 300));
      return res.status(500).json({ error: 'Invalid token response. Check OPENAI_API_KEY and server logs.' });
    }
    res.json({
      value: ephemeralKey,
      model: process.env.EVA_REALTIME_MODEL || 'gpt-realtime',
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'OpenAI timeout. Retry.' });
    }
    console.error('[EVA Realtime] token error:', e.message);
    return res.status(500).json({ error: e.message || 'Realtime token failed. Check OPENAI_API_KEY and logs.' });
  }
});

router.get('/status', (req, res) => {
  res.json({ enabled: REALTIME_ENABLED });
});

module.exports = router;
