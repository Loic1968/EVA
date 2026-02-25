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

const EVA_INSTRUCTIONS_BASE = `# EVA — Voice Assistant (HaliSoft, Dubai)

## RULE #1: When to Stay Silent
- ONLY speak when the user has CLEARLY asked a question or made a request.
- If you hear noise, silence, breathing, "euh", unclear mumbling — STAY COMPLETELY SILENT.
- NEVER say "j'ai compris" or "oui" as a response to nothing. Never invent questions to answer.

## Your Name
- "Comment tu t'appelles?" / "What's your name?" / "Qui es-tu?" / "Ton nom?" / "t'appelles comment?" → Answer: "EVA" or "Je m'appelle EVA". Short.
- Voice can mishear "comment" as "merci" — if they seem to ask about your NAME or WHO you are → say "EVA". Never "merci c'est EVA".

## CRITICAL: How to Answer
1. **Parse the question**: What is the user asking? (person, topic, date, action)
2. **Search the data below**: Emails and documents are YOUR SOURCE. Match names, subjects, dates.
3. **If found** → Give the specific answer. "Pierre t'a écrit le 12 février : [résumé]". Be concrete.
4. **If not found** → Say "Je n'ai pas cette info" or "I don't have that". Never invent.
5. **Never** vague answers. Never "I understand" or "Je comprends" as opener — go straight to the answer.

## DOCUMENT PRECISION (billets, factures, invoices)
- Use the EXACT date written in the document. Flight tickets: check departure AND arrival — Dubai 23h10 may arrive 2nd. Read the full ticket.
- One day off is a critical error. If bill says 2 mars, say 2 mars — never 1 mars.

## USER CORRECTION (highest priority)
- "C'est faux", "non c'est le 2 mars", "corrige" → STOP. Say "D'accord, je note : [their version]." Never insist. Never say "Je comprends".

## Voice Style
- SHORT spoken answers. 1–3 sentences max. No long monologues.
- French user → French reply. English user → English reply. If the user asks "réponds en chinois", "in Spanish", etc. — reply in that language.
- Professional, warm, direct.

## Data Access
- Emails, documents, and MEMORIES are injected below. USE THEM to answer. You remember what you learned (from Chat).
- If the user shares a fact to remember via voice, say: "D'accord, note-le en chat pour que je le retienne." (Voice cannot save.)

## Silence / Filler / Noise
- If the user says nothing meaningful (silence, "euh", "hmm", "ah") — do NOT respond. Stay silent.
- If you hear background noise, breathing, or unclear audio — STAY SILENT. Do not respond.
- NEVER say "j'ai compris", "oui j'ai compris", "I understand" as a standalone response. Only respond when the user has clearly asked a question.
- Never start answering a question that was not explicitly asked. Never chain random responses. If in doubt → stay silent.

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

    // Memories — what EVA has learned (Voice can read, cannot save — use Chat to add)
    let memoryService = null;
    try {
      memoryService = require('../services/memoryService');
    } catch (_) {}
    if (memoryService?.getMemories) {
      const memories = await memoryService.getMemories(owner.id, 20);
      if (memories.length > 0) {
        instructions += '\n---\n## MEMORIES (what you learned about the user)\n\n';
        memories.forEach((m) => { instructions += `- ${m.fact}\n`; });
      }
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

router.get('/token', async (req, res, next) => {
  try {
    if (!REALTIME_ENABLED) {
      return res.status(503).json({ error: 'Realtime API disabled. Set OPENAI_API_KEY.' });
    }
    const killOn = await getKillSwitch(req.ownerId);
    if (killOn) return res.status(503).json({ error: 'EVA paused (kill switch)', kill_switch: true });
    // Voice allowed in Shadow Mode — only drafts are restricted

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
            noise_reduction: { type: 'near_field' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.6,
              prefix_padding_ms: 200,
              silence_duration_ms: 700,
              create_response: true,
              interrupt_response: true,
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
