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
const { getAliceMode } = require('../services/settingsService');

// ── Alice voice persona (injected when Alice mode is active) ──
const ALICE_VOICE_PERSONA = `
## IDENTITY: You are ALICE — Loic's executive assistant (powered by EVA).
- You are NOT "EVA" when Alice mode is on. You are Alice.
- "Comment tu t'appelles?" → "Alice." / "Who are you?" → "Alice, your executive assistant."
- Casual but professional. Like a trusted Chief of Staff who's also a friend.
- Address Loic by name naturally: "Hey Loic", "Morning, Loic."
- Never robotic. Never "Certainly!" or "Of course!". Be direct.

## GREETINGS → MORNING BRIEFING
When Loic says "hey", "bonjour", "salut", "good morning":
1. Greet by name: "Morning, Loic."
2. Summarize today's calendar (or say it's clear)
3. Highlight notable emails
4. Offer: "Anything specific you want me to keep an eye on?"
Do NOT just say "Bonjour, comment je peux t'aider?" — Alice always brings value.

## VOICE STYLE
- 1–3 sentences max. Conversational, sharp.
- Frame for Loic's business context (HaliSoft — trade finance, invoice factoring).
- Match language: French → French. English → English.
`;

const EVA_INSTRUCTIONS_LEGACY = `# EVA — Voice Assistant (HaliSoft)

## RULE #1: ONLY respond to CLEAR questions or requests
- Respond ONLY when the user explicitly ASKS A QUESTION or MAKES A REQUEST.
- Noise, silence, breathing, "euh", "hmm", "ah", coughing — DO NOT RESPOND. Stay completely silent.
- NEVER say "j'ai compris", "oui", "d'accord" as a response to nothing. Never invent questions.
- If unsure (short/ambiguous message, possible noise) → stay silent. Do not guess.
- SINGLE ISOLATED WORDS that make no sense ("chien", "sylvestre", "dernier", "leader", "grinçant") → likely TRANSCRIPTION ERRORS. Say "Peux-tu répéter ?" or stay silent. Do NOT answer with calendar/flight info.
- If you receive 1-2 incoherent words → IGNORE or "Peux-tu répéter ?" — wait for a real sentence. Never assume it's about a flight.

## Check-in
- "Tu m'entends?", "Tu m'écoutes?", "Are you there?" → "Oui" or "Oui, je t'entends." Only. Nothing else.
- **Transcription errors**: La reconnaissance peut mal transcrire ("Leopard" pour "tu m'entends", "est-ce que" mal compris). Si un mot isolé semble incohérent mais le contexte ressemble à un check-in → réponds "Oui, je t'entends." Une seule fois, pas plusieurs réponses.

## Your Name
- "Comment tu t'appelles?" / "What's your name?" / "Qui es-tu?" → "EVA". Short only.

## Complete answers (critical)
- One clear, complete sentence. Never trail off with "Et vraiment...", "Il parlait de...", "Apparemment...". No truncated phrases. No "Bravo!" alone.
- ONE response per turn. Never chain multiple short answers ("Oui, je t'entends." "C'est pourquoi..." "Oui, je suis là.") — pick ONE, say it, stop.
- NEVER invent locations (Dubaï, Paris, etc.) if the user did NOT say them. "La situation actuelle" = global current events, not "à Dubaï".
- NEVER say nonsensical phrases ("Elle nous baille", fragments). If unsure → "Peux-tu répéter ?"
- "C'est quoi le problème?", "ça marche pas", "marche pas" → Réponds: "Désolée, j'ai peut-être mal compris. Dis-moi ce que tu cherches — actualités, Dubaï, vols — ou essaie en chat."

## How to Answer
1. Parse: What is the user asking? (person, topic, date, action)
2. Search: Emails, documents, calendar below. Match names, subjects, dates.
3. Found → Give the specific answer. Be concrete.
4. Not found (vol, billet, Shanghai, réservation) → "Je n'ai pas cette info dans mes données. Connecte Gmail et Google Calendar (Paramètres > Données), ou uploade ton billet dans Documents." Jamais "vérifie sur le site de la compagnie". Propose l'action concrète.
5. Never vague. Never "I understand" as opener — go straight to the answer.

## Documents & Calendar — USE ONLY when explicitly asked
- Use ## Documents / ## Calendar ONLY when the user CLEARLY asks about: vol, billet, flight, Shanghai, Dubaï, rendez-vous, meeting, email, calendrier, réservation.
- Ambiguous or generic questions ("c'est l'heure?", "bienvenue", "je suis", "quel temps?") → do NOT answer from documents/calendar. Answer literally (time, weather via web, etc.) or ask to repeat.
- Never assume a short/incomplete phrase ("je suis", "dernier", "bienvenue") = flight/calendar question. When in doubt → ask "Tu parles de quoi — l'heure, la météo, ton vol ?"
- When ## Documents appears and question IS about flight/ticket: use EXACT dates from the document. 2 mars ≠ 1 mars.

## Corrections & uncertain facts
- "C'est faux", "non c'est le 2 mars" → "D'accord, je note : [their version]." Never insist.
- If the user says your answer is wrong (e.g. "c'est faux", "n'importe quoi", "comment tu sais ça?"): do NOT repeat the same date or fact. Say once that you were going by calendar/documents, and that if it's wrong they can give you the correct info. Never flip between two dates (e.g. 3 mars then 4 mars). One clear correction only.

## Voice Style
- 1–3 sentences max. French user → French. English → English.
- Professional, direct.

## Data & Memories
- Use ## Emails, ## Documents, ## Calendar below to answer.
- Fact to remember → "Note-le en chat pour que je le retienne."

## Stop
- "Stop", "arrête", "tais-toi", "stop talking", "be quiet", "silence" → stop immediately. Do not continue speaking.

## Web search (when ## Web search appears below)
- Si la section ## Web search est présente dans tes instructions, utilise ces résultats pour répondre. Cite les sources (titre + URL). Vols, actualités, prix.`;

const EVA_VOICE_DIRECT = `You are EVA. Comprends et réponds comme ChatGPT — naturellement. Tu as accès à ## Emails, ## Documents, ## Calendar, ## Web search. Utilise-les quand pertinent. Réponses courtes pour la voix. "Stop"/"tais-toi" pour arrêter.`;

const EVA_INSTRUCTIONS_BASE = process.env.EVA_DIRECT_MODE === 'true'
  ? EVA_VOICE_DIRECT
  : process.env.EVA_OVERHAUL_ENABLED === 'true'
    ? getCanonicalPrompt('voice')
    : EVA_INSTRUCTIONS_LEGACY;

async function buildInstructionsWithContext(ownerId) {
  const SILENCE_RULE = process.env.EVA_DIRECT_MODE === 'true'
    ? ''
    : 'STRICT: Réponds UNIQUEMENT aux questions/demandes claires. Bruit, "euh", silence → NE RÉPONDS PAS.\n\n';

  // Check Alice mode: env var OR per-user setting (ignored when EVA_DIRECT_MODE)
  let isAlice = process.env.EVA_DIRECT_MODE === 'true' ? false : process.env.EVA_ALICE_MODE === 'true';
  if (!isAlice && ownerId) {
    try { isAlice = await getAliceMode(ownerId); } catch (_) {}
  }

  let instructions = SILENCE_RULE + (isAlice ? ALICE_VOICE_PERSONA + '\n' : '') + EVA_INSTRUCTIONS_BASE;
  if (isAlice) {
    // Override the name rule: Alice, not EVA
    instructions = instructions.replace(
      /## Your Name\n.*?→ "EVA".*?\n/s,
      '## Your Name\n- "Comment tu t\'appelles?" / "What\'s your name?" / "Qui es-tu?" → "Alice." Short only.\n'
    );
    console.log('[EVA Realtime] Alice mode active for voice');
  }

  let transcriptionLang = null;
  const raw = process.env.EVA_VOICE_EAGERNESS || 'medium';
  const turnEagerness = ['low', 'medium', 'high', 'auto'].includes(raw) ? raw : 'medium';

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
    } else     if (chatLang === 'en') {
      instructions = 'CRITICAL: Reply ONLY in English.\n\n' + instructions;
      transcriptionLang = 'en';
    } else {
      transcriptionLang = 'fr';
    }

    const now = new Date();
    const dateTimeStr = now.toLocaleString(chatLang === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    instructions += `\n---\n## DATE ET HEURE ACTUELLES / CURRENT DATE & TIME\nMaintenant: ${dateTimeStr}. Réponds avec cette info pour "Quelle heure est-il?", "On est quel jour?", "What time is it?", "What's the date?".\n`;

    // Memories — memory_items + feedback + legacy (Voice can read, cannot save — use Chat to add)
    try {
      const memoryItems = require('../services/memoryItemsService');
      const feedbackService = require('../services/feedbackService');
      const memoryService = require('../services/memoryService');
      const [items, feedback, legacy] = await Promise.all([
        memoryItems.getMemoryItems(owner.id, 12),
        feedbackService.getRecentFeedback(owner.id, 5),
        memoryService.getMemories(owner.id, 6),
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
      const recent = await gmailSync.getRecentEmails(owner.id, 10);
      if (recent.length > 0) {
        console.log(`[EVA Realtime] Injected ${recent.length} emails`);
        instructions += '\n\n---\n## EMAILS (use to answer questions about messages, people, dates)\n\n';
        recent.forEach((e, i) => {
          const date = new Date(e.received_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
          const isSent = Array.isArray(e.labels) ? e.labels.includes('SENT') : (e.labels && /"SENT"|'SENT'/.test(String(e.labels)));
          const who = isSent ? `TO: ${Array.isArray(e.to_emails) ? e.to_emails.join(', ') : e.to_emails || '—'}` : `FROM: ${e.from_name || e.from_email}`;
          const body = ((e.body_preview || e.snippet || '').replace(/\s+/g, ' ').trim()).slice(0, 280);
          instructions += `[Email ${i + 1}] ${who} | ${(e.subject || '').slice(0, 50)} | ${date}\n${body}\n\n`;
        });
      }
    }

    // Documents — indexed content (flights, tickets, travel)
    let docProcessor = null;
    try {
      docProcessor = require('../services/documentProcessor');
    } catch (_) {}
    if (docProcessor?.getRecentDocuments) {
      const docs = await docProcessor.getRecentDocuments(owner.id, 4);
      if (docs.length > 0) {
        console.log(`[EVA Realtime] Injected ${docs.length} documents`);
        instructions += '\n---\n## DOCUMENTS — TU AS ACCÈS : lis et réponds à partir du contenu ci-dessous (flights, tickets, Shanghai)\n\n';
        docs.forEach((d, i) => {
          instructions += `[Doc ${i + 1}] ${d.filename}:\n${(d.content_text || '').slice(0, 2500)}\n\n`;
        });
      }
    }

    // Calendar — upcoming events
    let calendarSync = null;
    try {
      calendarSync = require('../services/calendarSync');
    } catch (_) {}
    if (calendarSync?.getUpcomingEvents) {
      const events = await calendarSync.getUpcomingEvents(owner.id, 6, 7);
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

    // Web search (Tavily) — same as Alice: inject latest news at connection time so voice can answer "actualités", "quoi de neuf"
    let ws = null;
    try {
      ws = require('../services/webSearchService');
    } catch (_) {}
    if (ws?.isAvailable?.()) {
      try {
        const lang = chatLang === 'en' ? 'en' : 'fr';
        const query = lang === 'fr' ? 'actualités principales aujourd\'hui' : 'latest world news today';
        const data = await ws.search(query, { maxResults: 4, topic: 'news' });
        const formatted = ws.formatForContext?.(data);
        if (formatted) {
          instructions += '\n---\n' + formatted.trim() + '\n';
          console.log('[EVA Realtime] Injected web search (same as Alice)');
        }
      } catch (e) {
        console.warn('[EVA Realtime] Web search inject failed:', e.message);
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
        max_output_tokens: 1024,
        audio: {
          input: {
            transcription: transcriptionLang ? {
              model: 'gpt-4o-transcribe',
              language: transcriptionLang,
            } : undefined,
            noise_reduction: { type: 'near_field' },
            turn_detection: {
              type: 'semantic_vad',
              create_response: true,
              interrupt_response: true,
              ...(turnEagerness ? { eagerness: turnEagerness } : { eagerness: 'low' }),
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
      instructions, // client uses for session.update when injecting web search
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

/** Format MCP search results for EVA Realtime context. */
function formatWebContextForRealtime(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  let text = '\n\n## Web search (infos à jour — cite les sources)\n';
  text += "Utilise ces résultats pour répondre. Cite la source (titre + URL) quand tu t'en sers. Si l'info n'est pas ici, dis \"Je n'ai pas trouvé d'info récente\".\n\n";
  results.forEach((r, i) => {
    const title = r.title || 'Source';
    const url = r.url || '';
    const content = (r.content || '').trim().slice(0, 1500);
    text += `**${i + 1}. ${title}**\n`;
    if (url) text += `URL: ${url}\n`;
    if (content) text += `${content}\n\n`;
  });
  return text;
}

/** Web search assist for EVA Realtime voice — LLM router + MCP or Tavily fallback. */
router.post('/web-assist', async (req, res) => {
  try {
    const { transcript, history } = req.body || {};
    const txt = typeof transcript === 'string' ? transcript.trim() : '';
    if (!txt || txt.length > 2000) return res.json({ webContext: null });

    const router = require('../services/webSearchRouter');
    const hist = Array.isArray(history) ? history.filter((h) => h?.role && h?.content) : [];
    const { need, query: routedQuery, topic } = await router.routeWithLLM(txt, hist);
    if (!need || !routedQuery) return res.json({ webContext: null });

    const mcpClient = require('../services/mcpClient');
    let results = null;
    let source = null;

    if (mcpClient.isConnected()) {
      const toolName = topic === 'news' ? 'web.search_news' : 'web.search';
      const args = { query: routedQuery, topic, max_results: 5, time_range: topic === 'news' ? 'day' : undefined };
      const result = await mcpClient.callTool(toolName, args, {
        actor_id: req.ownerId || 'eva-assistant',
        actor_role: 'platform_admin',
        tenant_id: null,
      });
      if (result.ok && Array.isArray(result.data?.results) && result.data.results.length > 0) {
        results = result.data.results;
        source = 'mcp';
      }
    }

    if (!results) {
      const ws = require('../services/webSearchService');
      if (ws?.isAvailable && ws.isAvailable()) {
        try {
          const data = await ws.search(routedQuery, {
            maxResults: 5,
            topic: topic === 'news' ? 'news' : 'general',
            timeRange: topic === 'news' ? 'day' : null,
          });
          results = data?.results || [];
          source = 'tavily';
        } catch (e) {
          console.warn('[EVA Realtime] web-assist Tavily fallback failed:', e.message);
        }
      }
    }

    const webContext = Array.isArray(results) && results.length > 0
      ? formatWebContextForRealtime(results)
      : null;

    if (webContext) {
      console.log('[EVA Realtime] web-assist via', source || 'none');
    }

    res.json({ webContext });
  } catch (err) {
    console.warn('[EVA Realtime] web-assist failed:', err.message);
    res.json({ webContext: null });
  }
});

module.exports = router;
