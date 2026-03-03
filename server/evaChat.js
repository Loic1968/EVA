/**
 * EVA AI – conversation with Claude or GPT (user choice).
 * Phase 2: Email context injection from Gmail sync.
 */
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

// Lazy-load gmailSync and calendarSync to avoid circular dependency issues at startup
let gmailSync = null;
let calendarSync = null;
function getGmailSync() {
  if (!gmailSync) {
    try {
      gmailSync = require('./services/gmailSync');
    } catch (e) {
      console.warn('[EVA Chat] Gmail sync not available:', e.message);
    }
  }
  return gmailSync;
}
function getCalendarSync() {
  if (!calendarSync) {
    try {
      calendarSync = require('./services/calendarSync');
    } catch (e) {
      console.warn('[EVA Chat] Calendar sync not available:', e.message);
    }
  }
  return calendarSync;
}

let webSearchService = null;
function getWebSearchService() {
  if (!webSearchService) {
    try {
      webSearchService = require('./services/webSearchService');
    } catch (e) {
      console.warn('[EVA Chat] Web search not available:', e.message);
    }
  }
  return webSearchService;
}

/** Mode commands: /brief, /draft, /execute (server-side parsed) */
const MODE_HINTS = {
  BRIEF_ME: 'Respond concisely. Bullet points or 2–3 sentences max. No preamble.',
  DRAFT_REVIEW: 'Draft the requested content for Loic to review before sending. Mark as DRAFT.',
  EXECUTE_GUARDED: 'Never execute actions autonomously. Provide an action plan with safety checks. Wait for explicit "GO" from the user before any real action.',
};

function parseCommand(text) {
  const t = (text || '').trim();
  if (/^\/reset\b/i.test(t)) return { command: 'reset', message: t.replace(/^\/reset\s*/i, '').trim(), mode: null };
  if (/^\/brief\b/i.test(t)) return { command: 'brief', message: t.replace(/^\/brief\s*/i, '').trim(), mode: 'BRIEF_ME' };
  if (/^\/draft\b/i.test(t)) return { command: 'draft', message: t.replace(/^\/draft\s*/i, '').trim(), mode: 'DRAFT_REVIEW' };
  if (/^\/execute\b/i.test(t)) return { command: 'execute', message: t.replace(/^\/execute\s*/i, '').trim(), mode: 'EXECUTE_GUARDED' };
  if (/^eva\s+diag\s+personal-tools\s*$/i.test(t)) return { command: 'eva_diag_personal_tools', message: '' };
  if (/^\/alice\s*(on|off)?\s*$/i.test(t)) {
    const toggle = (t.match(/^\/alice\s*(on|off)?\s*$/i) || [])[1];
    return { command: 'alice_toggle', toggle: toggle ? toggle.toLowerCase() : null, message: '' };
  }
  const rememberMatch = t.match(/^\/remember\s+(\S+)=(.+)$/is);
  if (rememberMatch) return { command: 'remember', key: rememberMatch[1].trim(), value: rememberMatch[2].trim(), message: '' };
  const correctMatch = t.match(/^\/correct\s+(\S+)=(.+)$/is);
  if (correctMatch) return { command: 'correct', key: correctMatch[1].trim(), value: correctMatch[2].trim(), message: '' };
  const forgetMatch = t.match(/^\/forget\s+(.+)$/is);
  if (forgetMatch) return { command: 'forget', key: forgetMatch[1].trim(), message: '' };
  if (/^\/memory\s*$/i.test(t)) return { command: 'memory', message: '' };
  return { command: null, message: t, mode: null };
}

const { getCanonicalPrompt } = require('./prompts/canonicalPrompt');
const { getAssistantPrompt } = require('./systemPrompt');
const { getAlicePrompt } = require('./prompts/alicePrompt');
const { buildAllTools, isOrchestratorTool, executeOrchestratorTool, isMcpTool, executeMcpTool, createTrace, traceToolCall, MAX_TOOL_ROUNDS } = require('./services/toolOrchestrator');

const ANTI_HALLUCINATION = `# RÈGLES ABSOLUES (vérifier AVANT chaque réponse)
- NE JAMAIS inventer ce que l'utilisateur a dit. "C'est un bon film" ≠ "tu n'as rien demain". "C'est moi que voilà" ≠ "vol annulé".
- NE JAMAIS poser de questions qu'il n'a pas posées. Réponds à CE QU'IL A DIT, pas à une interprétation.
- UNE question = UNE réponse directe. Pas de suivi inventé, pas de "et si...?", pas de propositions non demandées.
- Si tu ne comprends pas → "Oui ?" ou "Peux-tu préciser ?". Jamais inventer pour combler.

## INTERDIT (vol, billet, Shanghai, réservation)
JAMAIS: "Je n'ai pas accès", "Je ne peux pas accéder", "pourrais-tu me donner", "Peux-tu me donner plus de détails", "Pour pouvoir t'aider correctement", "vérifie dans ton email", "consulte ton email", "vérifier sur l'application", "application de ta compagnie", "le nom de la compagnie", "le numéro de vol", "quelle compagnie", "quelle date", "connais-tu la date".
RÉPONSE OBLIGATOIRE si pas de données (Documents/Emails/Calendar vides): "Je n'ai pas cette info dans mes données. Connecte Gmail et Google Calendar (Paramètres > Données), ou uploade ton billet dans Documents." Pas de question de suivi. JAMAIS demander plus de détails.

## VOL / BILLET — NE JAMAIS INVENTER
Rapporte UNIQUEMENT ce qui est EXPLICITEMENT écrit dans ## Emails / ## Documents / ## Calendar. Si l'email dit "arrivée 2 mars 15h05" → dis ça. Si l'heure de DÉPART n'est pas écrite → ne pas l'inventer (03h10, 09h00, etc.). Si seul le numéro de vol est indiqué → dis le numéro, pas une heure inventée.

## INTERDIT (quoi de neuf, actualités ville)
JAMAIS de réponse générique (Expo 2020, gratte-ciels, tourisme, "Dubai est en évolution"). Si ## Web search vide → "Je n'ai pas trouvé d'infos récentes sur [ville]."
Quand ## Documents/## Emails/## Calendar ont du contenu → lis et réponds. Tu AS accès.
Quand ## Web search a du contenu (résultats Tavily) → tu AS accès au web via ces résultats. Utilise-les et cite les sources. JAMAIS dire "je n'ai pas accès à Internet" dans ce cas.

`;

const EVA_SYSTEM_LEGACY = `# PRINCIPE FONDAMENTAL — NE JAMAIS INVENTER
Tu réponds UNIQUEMENT au DERNIER message. Comprends l'intention : si c'est une vraie question (priorités, agenda, emails, docs) → réponds à la question. "Oui ?" UNIQUEMENT pour messages ambigus ou trop courts ("ok", ".", "Bonjour" seul).

# FLUX AVANT CHAQUE RÉPONSE — VÉRIFIER EN PREMIER
0. PRIORITÉS: "Résume mes priorités" / "Summarize my priorities" / "mes priorités" / "my priorities" / "What are my priorities?" → Synthétise à partir de ## Calendar (événements à venir), ## Emails (importants/non lus), ## Documents si pertinent. Liste en bullets, court. Si aucune donnée : "Calendrier et emails non synchronisés. Va dans Paramètres > Données pour les connecter."
1. Lis le dernier message. Qu'a-t-il LITTÉRALEMENT dit?
2. Question explicite? ("où je suis né?", "ma date de naissance?") → Réponds à CETTE question UNIQUEMENT. Une réponse courte.
3. Check-in? ("tu m'entends ?", "tu m'écoutes ?") → "Oui" ou "Oui, je t'entends." Rien d'autre.
4. Validation? ("propre", "c'est bon", "nickel", "parfait") → "Parfait." ou "Ok." Ne JAMAIS inventer de modif (logo, etc.).
5. Énoncé de fait? ("suis Marie", "j'ai habité 9 ans") → save_memory + "Noté."
6. Ni l'un ni l'autre? Message ambigu/court ("c'est chaud", "système", "ok", "...") → "Oui ?". Pour toute question sur priorités/agenda/emails/docs → réponds à la question, pas "Oui ?".

# UNE QUESTION = UNE RÉPONSE
- "Où je suis né?" → "Lille." Pas de date, pas de nationalité.
- "Ma date de naissance?" → la date. Point.
- Ne cumule jamais plusieurs faits sauf si l'utilisateur demande un récap explicite.

# INTERDITS (NON-NÉGOCIABLES)
- Quand tu n'as PAS la réponse (ex: statut assurance) → une phrase courte. Ex: "Je n'ai pas trouvé d'info sur ta demande d'assurance." Pas de liste d'emails "peut-être liés".
- "Je comprends" — jamais. Inventer des plages d'années.
- "je note" / "D'accord, je note" + fait que l'utilisateur N'A PAS dit dans son message → JAMAIS. Si tu n'as pas lu le fait dans son message LITTÉRAL, ne sauvegarde rien.
- "Propre", "c'est bon", "nickel" = validation, pas demande de modif. Réponds "Parfait." ou "Ok." Ne propose JAMAIS de changer le logo ou autre.
- Déduire du passeport/documents (taille, poids, yeux, adresse) et dire "je note" → JAMAIS. Les documents sont pour RÉPONDRE aux questions, pas pour inventer ce que l'utilisateur "aurait dit".
- "c'est chaud", "système", "que peut-être", ".", "Bonjour" seul → pas des énoncés. Réponds "Oui ?" ou "Bonjour.", pas de save_memory.

# DOCUMENTS (DOCS-FIRST — ne jamais inventer)
- Toujours chercher dans ## Documents pour les questions sur contrats, billets, procédures, term sheets.
- Cite la source: (Source: filename, section N). Ex: "D'après ton contrat (Source: contract.pdf, section 2) : [contenu]."
- Si pas trouvé dans les docs → "Je n'ai pas trouvé ça dans tes documents." JAMAIS inventer.
- "résume mon cv" → "D'après ton CV : [contenu]." Pas de save_memory. Cite exactement. Pas d'inférence.

## CORRECTION
- "j'ai jamais dit ça", "tu inventes" → "Désolé, j'ai inventé. Tu peux me donner la bonne info?" Ne sauve rien.
- Correction uniquement si valeur explicite ("non c'est le 2 mars").

You are EVA, a Personal AI Digital Twin for the user. The user may introduce themselves: "suis Marie", "je suis Loic" — save their name and treat them as the data owner. HaliSoft context: trade finance, invoice factoring.

## Your Name — Answer Directly
- "Comment tu t'appelles?" / "What's your name?" / "Qui es-tu?" / "C'est quoi ton nom?" → Answer: "EVA" or "Je m'appelle EVA". Nothing else.
- Do NOT say "merci c'est EVA" — that confuses "merci" with a name question. If they ask your name → say "EVA".

## Your Identity
- Loic's AI proxy. Direct, efficient. Match user language (FR/EN). Reply in requested language when asked.

## About Loic & HaliSoft
- Trade finance, invoice factoring. 20+ years tech + international business. Ex-Incomlend. HaliSoft = onboarding platform for factoring.

## save_memory
- UNIQUEMENT quand le DERNIER message contient un fait EXPLICITE que l'utilisateur a dit : "suis Marie", "né à Lille", "je mesure 1m80" (s'il l'a écrit).
- JAMAIS si le fait vient des sections ## Documents, ## Emails, ## Calendar. Ces sections servent à RÉPONDRE, pas à sauvegarder comme préférence.
- JAMAIS pour ".", "Bonjour", "ok", ou message vide. Réponds "Oui ?" ou "Bonjour." sans sauvegarder.

## Capabilities (Memory Vault + Gmail + Documents + Calendar)
- **When ## Documents / ## Emails / ## Calendar have content below**: You HAVE the data. READ it and answer from it. NEVER say "Je n'ai pas la capacité d'accéder", "I don't have access to personal documents", "consulte ton email de confirmation", "check the airline app". The content is IN the prompt — use it.
- **When sections are empty** (vol, billet, Shanghai, réservation) : "Je n'ai pas cette info dans mes données. Connecte Gmail et Google Calendar (Paramètres > Données), ou uploade ton billet dans Documents." JAMAIS "vérifie sur le site" ni "je n'ai pas accès à tes réservations".
- **Flight time (Shanghai, Dubai, etc.)** : consulte TOUTES les sources (## Documents, ## Calendar, ## Emails). Si conflit (calendrier ≠ billet) → dis : "Il y a une confusion : le calendrier dit X, le billet dit Y. Laquelle est la bonne ?" Ne jamais privilégier une source en silence. Never say "I can't modify your calendar" — you CAN add and DELETE events.
- **User says the answer is wrong** ("c'est faux", "n'importe quoi", "comment tu sais ça?"): do NOT repeat the same date or fact. Say once that you were going by calendar/documents, and ask them to give the correct info. Never flip between two different dates (e.g. 3 mars then 4 mars). One clear acknowledgment only.
- SEARCH emails + documents first for flight confirmations, Shanghai, travel. If found → use create_calendar_event.
- If asked about something not in the data (vol, billet, Shanghai, etc.) : propose de connecter Gmail/Calendar ou d'uploader le billet. Jamais de réponse générique inutile.

## Style
- Concis. Pas de fluff. Jamais inventer de données. Calendrier: utilise create_calendar_event quand demandé.`;

const SHARED_CAPABILITIES = `
## Documents / Emails / Calendar / Web
- Quand ## Documents, ## Emails, ## Calendar ont du contenu → lis et réponds. Tu AS accès.
- Quand vides (vol, billet, Shanghai) → "Je n'ai pas cette info dans mes données. Connecte Gmail et Google Calendar (Paramètres > Données), ou uploade ton billet dans Documents." Pas de question de suivi.
- Quand ## Web search a du contenu ("what up in dubai") → utilise les résultats. Réponse concrète. Si vide → "Je n'ai pas trouvé d'infos récentes." Jamais de réponse générique (Expo, gratte-ciels, tourisme).`;

// Alice mode can be set via env var (static) or per-owner setting (dynamic).
// Static EVA_SYSTEM is used when alice mode is off; when on, aliceSystem is used.
const EVA_SYSTEM_BASE = ANTI_HALLUCINATION + (
  process.env.EVA_ASSISTANT_MODE === 'true'
    ? getAssistantPrompt() + SHARED_CAPABILITIES
    : process.env.EVA_OVERHAUL_ENABLED === 'true'
      ? getCanonicalPrompt('chat')
      : EVA_SYSTEM_LEGACY
);

const ALICE_SYSTEM = ANTI_HALLUCINATION + getAlicePrompt() + SHARED_CAPABILITIES;

// Resolve system prompt: Alice if enabled (env or per-owner), else base EVA.
function getSystemPromptBase(isAlice) {
  return isAlice ? ALICE_SYSTEM : EVA_SYSTEM_BASE;
}

// Back-compat alias
const EVA_SYSTEM = EVA_SYSTEM_BASE;

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY required for EVA chat');
  return new Anthropic({ apiKey: key.trim() });
}

function getOpenAIClient() {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key.trim()) throw new Error('OPENAI_API_KEY required when using GPT');
  return new OpenAI({ apiKey: key.trim() });
}

// Keywords that suggest the user is asking about emails (widened for French)
const EMAIL_KEYWORDS = /email|mail|envoy[eé]|re[çc]u|message|from|sent|wrote|[eé]crit|r[eé]pondu|contact[eé]|inbox|courrier|correspondance|dernier|dit|demand[eé]|r[eé]ponse|qui m'a|pierre|jean|paul|marie|assurance|insurance|statut|demande/i;

// Keywords for travel/documents (vol, billet, Shanghai, Emirates, passport, etc.)
const DOCUMENT_KEYWORDS = /vol|billet|avion|train|Shanghai|PVG|voyage|travel|flight|emirates|etihad|ticket|document|fichier|upload|upload[eé]|passport|passeport|date\s*de\s*naissance|birth\s*date|naissance|identit[eé]|cni|horaire|heure|contrat|contract|proc[eé]dure|procedure|terme[s]?|terms|policy|politique|cv|r[eé]sum[eé]|resume|facture|invoice|devis|quote|memo|m[eé]moire|memory\s*vault/i;

// Keywords for calendar (agenda, meeting, vol, rendez-vous, schedule)
const CALENDAR_KEYWORDS = /agenda|calendrier|calendar|meeting|rendez-vous|rdv|r[eé]union|schedule|plann|event|[eé]v[eé]nement|prochain|vol|lundi|mardi|mercredi|jeudi|vendredi|demain|aujourd'hui|this week|add.*(to|au)|ajout(e|er).*(au|to)|priorit[eé]|priority|priorities|priorités/i;

// Always inject recent context for owner (not just on keyword match) - helps comprehension
const ALWAYS_INJECT_RECENT = true;

// Message trop court ou sans question/fait clair → ne pas injecter documents/facts (évite hallucination)
const MINIMAL_WORDS = /^(ciel|ok|oui|non|d\'accord|\.\.\.|bonjour|salut|hello|hi|yo|ah|euh|hum|quoi|merci|hein|voilà|voila|c\'est chaud|système|que peut-être|propre|c\'est propre|c\'est bon|nickel|parfait)$/i;
// Check-in ou validation courte → pas de contexte doc/emails
const CHECKIN_OR_VALIDATION = /^(tu m\'entends\s*\??|tu m\'écoutes\s*\??|t\'entends\s*\??|t\'écoutes\s*\??|are you there\s*\??|do you hear me\s*\??|ok c\'est bon)$/i;
// Casual phrases — NOT questions, NOT facts. Don't inject heavy context (avoids "je note que tu n'as rien demain")
const CASUAL_PHRASES = /^(c\'est (un )?bon film|c\'est magnifique|le bébé|c\'est moi que voilà|il y a|simplement|d\'accord)$/i;
function isMinimalMessage(msg) {
  const t = (msg || '').trim();
  if (!t || t.length < 6) return true; // vide, "ciel", "ok"
  if (MINIMAL_WORDS.test(t)) return true; // mot seul
  if (CHECKIN_OR_VALIDATION.test(t)) return true;
  if (CASUAL_PHRASES.test(t)) return true; // casual → pas de contexte emails/calendar (évite hallucination)
  return false;
}

const CALENDAR_TOOLS = [
  {
    name: 'save_memory',
    description: 'Save a fact you learned. Use when user shares preferences, corrections, dates, names. category=correction when user says "c\'est faux" or "non c\'est Y". Provide key as canonical snake_case identifier (e.g. date_of_birth, next_flight_shanghai, passport_number) — use whatever key best describes the fact.',
    input_schema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'The fact to remember (value)' },
        key: { type: 'string', description: 'Optional canonical key (snake_case). Infer from content: date_of_birth, supplier_name, invoice_amount, etc.' },
        category: { type: 'string', description: 'Optional: correction (highest), preference, travel, contact, general' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Add an event to the user\'s Google Calendar. Use when the user asks to add a flight, meeting, appointment, or any calendar event. Extract date/time from emails or documents when available.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title (e.g. "Vol Shanghai PVG", "Meeting with Pierre")' },
        start: { type: 'string', description: 'Start date-time in ISO 8601 format (e.g. 2026-03-15T14:00:00+04:00) or date for all-day (2026-03-15)' },
        end: { type: 'string', description: 'End date-time ISO 8601, or same as start for 1h default' },
        description: { type: 'string', description: 'Optional description or flight details' },
        location: { type: 'string', description: 'Optional location (e.g. PVG, Dubai office)' },
      },
      required: ['title', 'start'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'Remove an event from the user\'s Google Calendar. Use when the user asks to delete, remove, cancel, or cancel a flight/meeting/event (e.g. "enlève le vol de dimanche", "supprime le meeting de lundi"). Pass the event_id from the ## Calendar context — each event shows (id: X).',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'Event ID from the calendar context (e.g. "42" or the id shown next to the event to delete)' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'create_draft',
    description: 'Create an email draft for the user to review and send. Use when the user asks to reply to an email, write an email, or draft a message. Provide body (required), to_emails (recipient), subject (or Re: for replies). For replies, set thread_id if you know the Gmail thread ID from the email context.',
    input_schema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Email body (plain text)' },
        to_emails: { type: 'string', description: 'Recipient email(s), comma-separated (e.g. "pierre@example.com")' },
        subject: { type: 'string', description: 'Subject line (e.g. "Re: Meeting next week")' },
        thread_id: { type: 'string', description: 'Gmail thread ID for replies (if known from email context)' },
      },
      required: ['body'],
    },
  },
];

async function executeTool(ownerId, name, input, toolOpts = {}) {
  // Route orchestrator tools (web_search, gmail_search, calendar_search, doc_search)
  if (isOrchestratorTool(name)) {
    return executeOrchestratorTool(name, input, ownerId);
  }
  // Route MCP tools (mcp_db_query_readonly, mcp_files_read, etc.)
  if (isMcpTool(name)) {
    return executeMcpTool(name, input, ownerId);
  }
  if (name === 'save_memory') {
    if (toolOpts.disableMemoryWrites) return { ok: true };
    const memoryService = require('./services/memoryService');
    const memoryItems = require('./services/memoryItemsService');
    try {
      const category = input.category || 'general';
      const kind = category === 'preference' ? 'preference' : category === 'correction' ? 'correction' : 'fact';
      const key = (input.key && input.key.trim()) ? memoryItems.slugify(input.key) : memoryItems.slugify(input.fact);
      await memoryItems.addMemoryItem(ownerId, kind, key, input.fact);
      const id = await memoryService.addMemory(ownerId, input.fact, category);
      // Wire to eva.facts when structured memory enabled — learn from live discussion
      if (ownerId && process.env.EVA_STRUCTURED_MEMORY === 'true') {
        try {
          const factsService = require('./services/factsService');
          if (kind === 'correction') {
            await factsService.addCorrection(ownerId, key, input.fact);
          } else if (kind === 'preference') {
            await factsService.addRemember(ownerId, key, input.fact);
          } else {
            await factsService.upsertFactSafe(ownerId, key, input.fact, 'conversation', null, 30);
          }
        } catch (e) {
          console.warn('[EVA Chat] save_memory → facts failed:', e.message);
        }
      }
      return id ? { ok: true, id } : { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }
  if (name === 'create_draft') {
    const db = require('./db');
    const { getKillSwitch, getShadowMode, getAutonomousMode } = require('./services/settingsService');
    const MAX_DRAFT_BODY = 50000;
    try {
      if (!ownerId) return { error: 'Must be logged in to create drafts' };
      const killOn = await getKillSwitch(ownerId);
      if (killOn) return { error: 'EVA is paused (kill switch)' };
      const shadowOn = await getShadowMode(ownerId);
      if (shadowOn) return { error: 'Drafts disabled in Shadow Mode' };
      const body = (input.body || '').trim().slice(0, MAX_DRAFT_BODY);
      if (!body) return { error: 'body is required' };
      const autonomousOn = await getAutonomousMode(ownerId);
      const initialStatus = autonomousOn ? 'approved' : 'pending';
      const r = await db.query(
        `INSERT INTO eva.drafts (owner_id, channel, thread_id, subject_or_preview, body, to_emails, status)
         VALUES ($1, 'email', $2, $3, $4, $5, $6)
         RETURNING id, status, subject_or_preview`,
        [
          ownerId,
          (input.thread_id || '').trim() || null,
          (input.subject || '').trim() || null,
          body,
          (input.to_emails || '').trim() || null,
          initialStatus,
        ]
      );
      const draft = r.rows[0];
      return {
        ok: true,
        id: draft.id,
        status: draft.status,
        subject: draft.subject_or_preview,
        message: draft.status === 'approved' ? 'Draft created (pre-approved). User can send from Drafts page.' : 'Draft created. User will review in Drafts page.',
      };
    } catch (err) {
      return { error: err.message };
    }
  }
  if (name === 'delete_calendar_event') {
    const calSync = getCalendarSync();
    if (!calSync?.deleteEvent) return { error: 'Calendar not available' };
    try {
      const eventId = (input.event_id || '').toString().trim();
      if (!eventId) return { error: 'event_id required' };
      await calSync.deleteEvent(ownerId, eventId);
      return { ok: true, deleted: true, message: 'Event removed from calendar.' };
    } catch (err) {
      return { error: err.message };
    }
  }
  if (name !== 'create_calendar_event') return { error: 'Unknown tool' };
  const calSync = getCalendarSync();
  if (!calSync?.createEvent) return { error: 'Calendar not available' };
  try {
    if (!input.title || !input.start) return { error: 'title and start required' };
    const end = input.end || input.start;
    const result = await calSync.createEvent(ownerId, {
      title: input.title,
      summary: input.title,
      start: input.start,
      end,
      description: input.description || '',
      location: input.location || '',
    });
    return { ok: true, id: result.id, htmlLink: result.htmlLink, summary: result.summary };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * @param {string} userMessage
 * @param {Array<{role:'user'|'assistant',content:string}>} [history]
 * @param {number|null} [ownerId] – owner ID for email context lookup
 * @param {string|null} [mode] – BRIEF_ME | DRAFT_REVIEW | EXECUTE_GUARDED
 * @param {{ attachedDocuments?: Array<{id:number, filename:string, content_text:string}> }} [opts]
 * @returns {Promise<{reply:string, model:string, tokens:{input:number,output:number}}>}
 */
async function reply(userMessage, history = [], ownerId = null, mode = null, opts = {}) {
  const aiProvider = opts.aiProvider === 'gpt' ? 'gpt' : 'claude';
  const model = aiProvider === 'gpt'
    ? (process.env.EVA_GPT_MODEL || 'gpt-4o')
    : (process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514');

  let systemPrompt;
  let authErrorBlock = '';
  const personalTools = require('./services/personalToolsService');
  const intent = personalTools.classifyIntent(userMessage);
  const isFlightIntent = intent === personalTools.INTENTS.FLIGHT_QUESTION;

  // Resolve Alice mode: env var (global) or per-owner setting
  let isAliceMode = process.env.EVA_ALICE_MODE === 'true';
  if (!isAliceMode && ownerId) {
    try {
      const { getAliceMode } = require('./services/settingsService');
      isAliceMode = await getAliceMode(ownerId);
    } catch (_) { /* settingsService may not export getAliceMode yet */ }
  }
  const basePrompt = getSystemPromptBase(isAliceMode);

  if (process.env.EVA_SMART_CONTEXT === 'true' && ownerId) {
    if ((personalTools.isPersonalToolsEnabled() || isFlightIntent) && isFlightIntent) {
      const flightContext = await personalTools.fetchFlightContext(ownerId, userMessage);
      if (flightContext?.authBlock) authErrorBlock = '\n\n' + flightContext.authBlock + '\n';
    }
    const contextBuilder = require('./contextBuilder');
    const { context } = await contextBuilder.buildContext({ ownerId, userMessage, history });
    const attached = (opts.attachedDocuments || []).map((d) => `**${d.filename}:**\n${(d.content_text || '').slice(0, 80000) || '(no text)'}`).join('\n\n');
    const attachedBlock = attached ? `\n\n## Attached by user (analyse first)\n${attached}\n` : '';
    const now = new Date();
    const dateTimeStr = now.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const dateTimeBlock = `\n\n## DATE ET HEURE ACTUELLES\nMaintenant: ${dateTimeStr}. Utilise pour "Quelle heure est-il?", "What time is it?".\n`;
    systemPrompt = basePrompt + authErrorBlock + dateTimeBlock + attachedBlock + (context || '');
  } else {
  // Tools-first for flight/calendar: fetch calendar + gmail + docs with expanded queries
  const useToolsFirst = personalTools.isPersonalToolsEnabled() || isFlightIntent;

  let flightContext = null;
  if (ownerId && !isMinimalMessage(userMessage) && useToolsFirst && isFlightIntent) {
    flightContext = await personalTools.fetchFlightContext(ownerId, userMessage);
  }

  // Auth error block — inject first so model knows not to ask airline/date
  let authErrorBlock = '';
  if (flightContext?.authBlock) {
    authErrorBlock = '\n\n' + flightContext.authBlock + '\n';
  }

  // Build email context: use flight context when available, else search on keywords
  let emailContext = '';
  if (ownerId && !isMinimalMessage(userMessage)) {
    try {
      const sync = getGmailSync();
      if (sync) {
        const shouldInject = ALWAYS_INJECT_RECENT || EMAIL_KEYWORDS.test(userMessage) || (flightContext?.emails?.length > 0);
        const emailResults = flightContext?.emails?.length > 0
          ? flightContext.emails
          : shouldInject
            ? (EMAIL_KEYWORDS.test(userMessage)
              ? await sync.searchEmails(ownerId, isFlightIntent ? personalTools.buildFlightEmailQuery(userMessage) : userMessage, 8, null, 'all')
              : await sync.getRecentEmails(ownerId, 5))
            : [];
        if (emailResults.length > 0) {
          emailContext = '\n\n## Emails (Memory Vault — inbox, sent, drafts)\n';
          emailContext += 'Use these emails to answer questions about flights, confirmations, who said what. Extract date, departure time, flight number if present. If multiple flights, ask: "Is it the one on <date> at <time>?"\n\n';
          emailResults.forEach((e, i) => {
            const isSent = Array.isArray(e.labels) ? e.labels.includes('SENT') : (e.labels && /"SENT"|'SENT'/.test(String(e.labels)));
            emailContext += `**Email ${i + 1}:**\n`;
            emailContext += isSent
              ? `- To: ${Array.isArray(e.to_emails) ? e.to_emails.join(', ') : e.to_emails || '—'}\n`
              : `- From: ${e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email}\n`;
            emailContext += `- Subject: ${e.subject}\n`;
            if (e.thread_id) emailContext += `- thread_id: ${e.thread_id}\n`;
            emailContext += `- Date: ${new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}\n`;
            emailContext += `- Preview: ${(e.body_preview || e.snippet || '').slice(0, 1000)}\n\n`;
          });
        }
      }
    } catch (err) {
      if (personalTools.isAuthError && personalTools.isAuthError(err)) {
        authErrorBlock = authErrorBlock || '\n\n## Google connection: AUTH_ERROR — Tell user: "Your Google connection needs re-auth. Reconnect Google account in Data Sources." Do NOT ask airline/date.\n';
      }
      console.warn('[EVA Chat] Email context lookup failed:', err.message);
    }
  }

  // Attached documents (user uploaded in chat) — highest priority, always inject
  let attachedDocContext = '';
  const attachedDocs = opts.attachedDocuments || [];
  if (attachedDocs.length > 0) {
    attachedDocContext = '\n\n## Attached documents (user just shared — analyse these first)\n';
    attachedDocs.forEach((d, i) => {
      const text = (d.content_text || '').slice(0, 80000);
      attachedDocContext += `**${d.filename || `Document ${i + 1}`}:**\n${text || '(no text extracted yet)'}\n\n`;
    });
  }

  // Build document context — DOCS-FIRST: always search for non-minimal messages
  let documentContext = '';
  if (ownerId && !isMinimalMessage(userMessage)) {
    try {
      const docProcessor = require('./services/documentProcessor');
      const shouldInject = ALWAYS_INJECT_RECENT || DOCUMENT_KEYWORDS.test(userMessage);
      let resolvedDocs = flightContext?.docs?.length > 0 ? flightContext.docs : [];
      if (resolvedDocs.length === 0 && shouldInject) {
        const searchQuery = userMessage + (isFlightIntent ? ' ' + (personalTools.buildFlightEmailQuery(userMessage) || '') : '');
        resolvedDocs = await docProcessor.searchDocumentsWithCitations(ownerId, searchQuery, 8);
        if (resolvedDocs.length === 0) {
          const recent = await docProcessor.getRecentDocuments(ownerId, 5);
          resolvedDocs = recent.map((d) => ({ ...d, citation: { doc_id: d.id, filename: d.filename, chunk_index: 0, chunk_id: null } }));
        }
        const filenameMatch = userMessage.match(/(?:emirates|etihad|flydubai)\s*(?:ticket|billet)?\s*(?:\.pdf)?|ticket\s*emirates|billet\s*emirates|\S+\.pdf/gi);
        if (filenameMatch) {
          const byName = await docProcessor.searchDocumentsByFilename(ownerId, filenameMatch[0].trim(), 3);
          const seen = new Set(resolvedDocs.map((d) => d.id));
          byName.filter((d) => !seen.has(d.id)).forEach((d) => { resolvedDocs.unshift(d); seen.add(d.id); });
        }
      }
      if (resolvedDocs.length > 0) {
        documentContext = '\n\n## Documents (Memory Vault) — DOCS-FIRST: réponds UNIQUEMENT à partir du contenu ci-dessous. Cite tes sources (filename, section/chunk).\n';
        documentContext += 'CITATION FORMAT: (Source: filename, chunk/section N). Si aucune donnée pertinente → "Je n\'ai pas trouvé ça dans tes documents."\n\n';
        const charLimit = isFlightIntent ? 15000 : 20000;
        resolvedDocs.forEach((d) => {
          const text = (d.content_text || d.content_preview || '').slice(0, charLimit);
          const cite = d.citation ? ` [Source: ${d.filename}, section ${(d.citation.chunk_index ?? 0) + 1}]` : '';
          documentContext += `**${d.filename}**${cite}:\n${text}\n\n`;
        });
      } else {
        documentContext = '(No documents found. User can upload in Documents page.)\n';
        documentContext += 'Si la question concerne des docs (contrats, billets, procédures) : "Je n\'ai pas cette info dans tes documents. Uploade-les dans Documents pour que je les analyse."\n';
        if (isFlightIntent && !authErrorBlock) {
          documentContext += 'If user asks flight time and no data: "Je n\'ai pas cette info. Connecte Gmail/Calendar ou uploade ton billet." Ask ONLY date OR airline OR PNR — not all.\n';
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Document context lookup failed:', err.message);
    }
  }

  // STRUCTURED FACT MEMORY (when EVA_STRUCTURED_MEMORY=true) — authoritative, before other context (skip if minimal)
  let structuredFactsContext = '';
  if (ownerId && !isMinimalMessage(userMessage) && process.env.EVA_STRUCTURED_MEMORY === 'true') {
    try {
      const factsService = require('./services/factsService');
      const facts = await factsService.getFacts(ownerId, 50);
      if (facts.length > 0) {
        structuredFactsContext = '\n\n## STRUCTURED FACT MEMORY (Authoritative)\n';
        structuredFactsContext += 'Use these facts ONLY when the user asks about that specific topic. Do NOT volunteer unsolicited facts.\n';
        structuredFactsContext += 'These override conflicting info from documents. If uncertain, say "Je n\'ai pas cette info". Never guess.\n\n';
        facts.forEach((f) => {
          const source = f.source_type || 'unknown';
          structuredFactsContext += `- ${f.key}: ${f.value} (${source}, priority ${f.priority})\n`;
        });
      }
    } catch (err) {
      console.warn('[EVA Chat] Structured facts lookup failed:', err.message);
    }
  }

  // PERSISTENT MEMORY: corrections > preferences > facts + feedback (EVA learns)
  let memoryContext = '';
  if (ownerId) {
    try {
      const memoryItems = require('./services/memoryItemsService');
      const feedbackService = require('./services/feedbackService');
      const memoryService = require('./services/memoryService');
      const [items, feedback, legacyMemories] = await Promise.all([
        memoryItems.getMemoryItems(ownerId, 30),
        feedbackService.getRecentFeedback(ownerId, 10),
        memoryService.getMemories(ownerId, 15),
      ]);
      const lines = [];
      if (items.length > 0) {
        lines.push('**Corrections et préférences (priorité maximale — utilise ces valeurs):**');
        items.forEach((m) => {
          const label = m.kind === 'correction' ? '[CORRECTION]' : m.kind === 'preference' ? '[PRÉFÉRENCE]' : '[FACT]';
          lines.push(`- ${label} ${m.key} = ${m.value}`);
        });
      }
      if (feedback.length > 0) {
        lines.push('\n**Feedback passé (à éviter / corriger):**');
        feedback.forEach((f) => {
          if (f.feedback_type === 'correction' && f.corrected_text) {
            lines.push(`- Éviter: "${(f.original_text || '').slice(0, 80)}..." → Utiliser: "${(f.corrected_text || '').slice(0, 80)}..."`);
          } else if (f.feedback_type === 'thumbs_down' && f.original_text) {
            lines.push(`- Éviter ce type de réponse: "${(f.original_text || '').slice(0, 100)}..."`);
          }
        });
      }
      if (legacyMemories.length > 0 && lines.length < 5) {
        lines.push('\n**Mémoires (save_memory):**');
        legacyMemories.slice(0, 10).forEach((m) => lines.push(`- ${m.fact}`));
      }
      if (lines.length > 0) {
        memoryContext = '\n\n## PERSISTENT MEMORY (ce que tu as appris — utilise-le)\n';
        memoryContext += 'Les corrections et préférences ci-dessus OVERRIDE tout sauf instruction explicite de l\'utilisateur.\n\n';
        memoryContext += lines.join('\n') + '\n';
      }
    } catch (err) {
      console.warn('[EVA Chat] Memory context lookup failed:', err.message);
    }
  }

  // Calendar context: use flight context when available (wider window), else upcoming events
  let calendarContext = '';
  if (ownerId && !isMinimalMessage(userMessage)) {
    try {
      const calSync = getCalendarSync();
      if (calSync) {
        const shouldInject = ALWAYS_INJECT_RECENT || CALENDAR_KEYWORDS.test(userMessage);
        const events = (flightContext?.calendarEvents?.length > 0)
          ? flightContext.calendarEvents
          : shouldInject
            ? await calSync.getUpcomingEvents(ownerId, isFlightIntent ? 20 : 10, isFlightIntent ? 90 : 14)
            : [];
        if (shouldInject || events.length > 0) {
          calendarContext = '\n\n## Calendar (upcoming events)\n';
          if (events.length > 0) {
            calendarContext += 'Use these for meetings, flights, schedule. Return: date, time, flight number if in title. To delete: delete_calendar_event with event id.\n\n';
            events.forEach((ev, i) => {
              const start = new Date(ev.start_at);
              const fmt = ev.is_all_day
                ? start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                : start.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              calendarContext += `**Event ${i + 1}** (id: ${ev.id}): ${ev.title || '(no title)'} | ${fmt}${ev.location ? ` @ ${ev.location}` : ''}${ev.gmail_address ? ` [${ev.gmail_address}]` : ''}\n`;
            });
          } else {
            calendarContext += '(No events — sync Google Calendar in Settings > Data Sources to see upcoming events.)\n';
            if (isFlightIntent && !authErrorBlock) {
              calendarContext += 'If flight question and no data: "Je n\'ai pas cette info. Connecte Gmail/Calendar ou uploade ton billet." Ask ONLY date OR airline OR PNR.\n';
            }
          }
        }
      }
    } catch (err) {
      if (personalTools.isAuthError && personalTools.isAuthError(err)) {
        authErrorBlock = authErrorBlock || '\n\n## Google connection: AUTH_ERROR — Tell user: "Your Google connection needs re-auth. Reconnect Google account in Data Sources." Do NOT ask airline/date.\n';
      }
      console.warn('[EVA Chat] Calendar context lookup failed:', err.message);
    }
  }

  // Web search (Tavily) — when user asks for latest news, current info, etc.
  let webContext = '';
  if (!isMinimalMessage(userMessage)) {
    let ws;
    try {
      ws = getWebSearchService();
      if (ws && ws.isAvailable() && ws.needsWebSearch(userMessage)) {
        const query = ws.extractQuery(userMessage) || userMessage;
        const topic = (ws.isNewsQuery && ws.isNewsQuery(userMessage)) ? 'news' : 'general';
        if (process.env.EVA_DEBUG === 'true') console.log('[EVA Chat] Web search query:', query, 'topic:', topic);
        const data = await ws.search(query, { maxResults: 5, topic });
        const formatted = ws.formatForContext(data);
        if (formatted) webContext = '\n\n' + formatted;
      } else if (ws && ws.needsWebSearch(userMessage) && !ws.isAvailable()) {
        webContext = '\n\n## Web search\nTAVILY_API_KEY non configurée. Dis: "La recherche web n\'est pas configurée (clé Tavily manquante). Ajoute TAVILY_API_KEY dans eva/.env."';
      }
    } catch (err) {
      console.warn('[EVA Chat] Web search failed:', err.message, err.response?.status, err.response?.data || '');
      const w = getWebSearchService();
      if (w && w.needsWebSearch(userMessage)) {
        webContext = '\n\n## Web search (erreur)\nLa recherche Tavily a échoué. Réponds: "La recherche web a rencontré un problème (réessaie dans un moment)." Ne dis pas "je n\'ai pas accès au Web".';
      }
    }
  }

  const now = new Date();
  const dateTimeStr = now.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dateTimeBlock = `\n\n## DATE ET HEURE ACTUELLES\nMaintenant: ${dateTimeStr}. Utilise pour "Quelle heure est-il?", "On est quel jour?", "What time is it?".\n`;
  systemPrompt = basePrompt + authErrorBlock + dateTimeBlock + attachedDocContext + structuredFactsContext + memoryContext + emailContext + documentContext + calendarContext + webContext;
  }
  // P4: Style / voice profile injection
  if (ownerId) {
    try {
      const { getStyleProfile } = require('./services/settingsService');
      const styleText = await getStyleProfile(ownerId);
      if (styleText) {
        systemPrompt += `\n\n## User's communication style (P4)\nMatch this tone and style when responding.\n${styleText}\n`;
      }
    } catch (err) {
      console.warn('[EVA Chat] Style profile lookup failed:', err.message);
    }
  }
  if (mode && MODE_HINTS[mode]) {
    systemPrompt += `\n\n## Current Mode: ${mode}\n${MODE_HINTS[mode]}`;
  }

  const contextWindow = Math.max(5, Math.min(100, Number(process.env.EVA_CONTEXT_WINDOW) || 25));
  const messages = [
    ...history.slice(-contextWindow).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const useThinking = process.env.EVA_USE_THINKING !== 'false';
  const createOptions = {
    model,
    max_tokens: 4096, // Must be > thinking.budget_tokens when thinking enabled
    system: systemPrompt,
    messages,
    tools: ownerId ? buildAllTools(CALENDAR_TOOLS) : [],
  };
  if (useThinking) {
    createOptions.thinking = { type: 'enabled', budget_tokens: 2048 };
    createOptions.temperature = 1; // Required when thinking is enabled (Anthropic API)
  } else {
    const tempRaw = process.env.EVA_TEMP;
    const temp = Number(tempRaw);
    if (!Number.isNaN(temp) && temp >= 0 && temp <= 2) {
      createOptions.temperature = temp;
    } else if (process.env.EVA_OVERHAUL_ENABLED === 'true') {
      createOptions.temperature = 0.2;
    } else {
      createOptions.temperature = 0.3; // Lower = less hallucination (legacy default)
    }
  }

  // GPT path (no tools) — when user selected GPT
  if (aiProvider === 'gpt') {
    try {
      const openai = getOpenAIClient();
      const oaiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages,
      ];
      const completion = await openai.chat.completions.create({
        model,
        messages: oaiMessages,
        max_tokens: 4096,
      });
      const text = completion.choices?.[0]?.message?.content || 'No response.';
      return {
        reply: text,
        model,
        ai_provider: 'gpt',
        tokens: {
          input: completion.usage?.prompt_tokens || 0,
          output: completion.usage?.completion_tokens || 0,
        },
      };
    } catch (e) {
      if (/OPENAI_API_KEY|API key/i.test(String(e.message))) {
        throw new Error('GPT requires OPENAI_API_KEY. Set it in Settings or switch to Claude.');
      }
      throw e;
    }
  }

  const client = getClient();
  let response;
  let currentMessages = [...messages];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const maxToolRounds = MAX_TOOL_ROUNDS;
  let round = 0;
  const trace = createTrace(isAliceMode ? 'alice' : mode || 'eva_standard');

  while (round < maxToolRounds) {
    response = await client.messages.create({ ...createOptions, messages: currentMessages });
    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    const toolUseBlocks = (response.content || []).filter((b) => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    const toolResults = [];
    for (const block of toolUseBlocks) {
      const t0 = Date.now();
      const result = await executeTool(ownerId, block.name, block.input || {}, { disableMemoryWrites: opts.disableMemoryWrites });
      const ms = Date.now() - t0;
      traceToolCall(trace, block.name, ms, result.ok !== false);
      if (process.env.EVA_DEBUG === 'true') {
        console.log(`[toolOrchestrator] ${block.name} → ${result.ok !== false ? '✓' : '✗'} (${ms}ms)`);
      }
      // Truncate large payloads to avoid context bloat
      const serialized = JSON.stringify(result);
      const content = serialized.length > 30000 ? serialized.slice(0, 30000) + '…(truncated)' : serialized;
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content,
      });
    }

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ];
    round++;
  }
  trace.iterations = round;

  const textBlock = response.content?.find((b) => b.type === 'text');
  const replyText = textBlock ? textBlock.text : 'No response.';

  return {
    reply: replyText,
    model: response.model || model,
    ai_provider: 'claude',
    trace,
    tokens: {
      input: totalInputTokens || response.usage?.input_tokens || 0,
      output: totalOutputTokens || response.usage?.output_tokens || 0,
    },
  };
}

/**
 * Create stream for SSE. Use .on('text', fn) for chunks, then await .finalMessage() for complete result.
 * @returns {Promise<{stream: object, model: string}>} stream has .on('text', cb), .finalMessage()
 */
async function createReplyStream(userMessage, history = [], ownerId = null, mode = null) {
  const client = getClient();
  const model = process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514';

  // Email context: same logic as reply() — skip if minimal (évite confusion)
  let emailContext = '';
  if (ownerId && !isMinimalMessage(userMessage)) {
    try {
      const sync = getGmailSync();
      if (sync) {
        const shouldInject = ALWAYS_INJECT_RECENT || EMAIL_KEYWORDS.test(userMessage);
        if (shouldInject) {
          const emailResults = EMAIL_KEYWORDS.test(userMessage)
            ? await sync.searchEmails(ownerId, userMessage, 5, null, 'all')
            : await sync.getRecentEmails(ownerId, 5);
          if (emailResults.length > 0) {
            emailContext = '\n\n## Emails (Memory Vault — inbox, sent, drafts)\n';
            emailContext += 'Use these emails to answer. Cite sender, date, subject when relevant. For create_draft replies, use thread_id when available.\n\n';
            emailResults.forEach((e, i) => {
              const isSent = Array.isArray(e.labels) ? e.labels.includes('SENT') : (e.labels && /"SENT"|'SENT'/.test(String(e.labels)));
              emailContext += `**Email ${i + 1}:**\n`;
              emailContext += isSent
                ? `- To: ${Array.isArray(e.to_emails) ? e.to_emails.join(', ') : e.to_emails || '—'}\n`
                : `- From: ${e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email}\n`;
              emailContext += `- Subject: ${e.subject}\n`;
              if (e.thread_id) emailContext += `- thread_id: ${e.thread_id}\n`;
              emailContext += `- Date: ${new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}\n`;
              emailContext += `- Preview: ${(e.body_preview || e.snippet || '').slice(0, 1000)}\n\n`;
            });
          }
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Email context lookup failed:', err.message);
    }
  }

  // Document context: DOCS-FIRST — same logic as reply()
  let documentContext = '';
  if (ownerId && !isMinimalMessage(userMessage)) {
    try {
      const docProcessor = require('./services/documentProcessor');
      const shouldInject = ALWAYS_INJECT_RECENT || DOCUMENT_KEYWORDS.test(userMessage);
      if (shouldInject) {
        let docResults = docProcessor.searchDocumentsWithCitations
          ? await docProcessor.searchDocumentsWithCitations(ownerId, userMessage, 8)
          : await docProcessor.searchDocuments(ownerId, userMessage, 8);
        if (docResults.length === 0) {
          const recent = await docProcessor.getRecentDocuments(ownerId, 5);
          docResults = recent.map((d) => ({ ...d, citation: { doc_id: d.id, filename: d.filename, chunk_index: 0 } }));
        }
        const filenameMatch = userMessage.match(/(?:emirates|etihad|flydubai)\s*(?:ticket|billet)?\s*(?:\.pdf)?|ticket\s*emirates|billet\s*emirates|\S+\.pdf/gi);
        if (filenameMatch) {
          const byName = await docProcessor.searchDocumentsByFilename(ownerId, filenameMatch[0].trim(), 3);
          const seen = new Set(docResults.map((d) => d.id));
          byName.filter((d) => !seen.has(d.id)).forEach((d) => { docResults.unshift({ ...d, citation: { doc_id: d.id, filename: d.filename, chunk_index: 0 } }); seen.add(d.id); });
        }
        documentContext = '\n\n## Documents (Memory Vault) — DOCS-FIRST : réponds à partir du contenu. Cite (Source: filename, section N).\n';
        if (docResults.length > 0) {
          docResults.forEach((d) => {
            const text = (d.content_text || d.content_preview || '').slice(0, 20000);
            const cite = d.citation ? ` [Source: ${d.filename}, section ${(d.citation.chunk_index ?? 0) + 1}]` : '';
            documentContext += `**${d.filename}**${cite}:\n${text}\n\n`;
          });
        } else {
          documentContext += '(No documents found. User can upload in Documents page.)\n';
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Document context lookup failed:', err.message);
    }
  }

  // STRUCTURED FACT MEMORY in stream mode (skip if minimal)
  let structuredFactsStream = '';
  if (ownerId && !isMinimalMessage(userMessage) && process.env.EVA_STRUCTURED_MEMORY === 'true') {
    try {
      const factsService = require('./services/factsService');
      const facts = await factsService.getFacts(ownerId, 50);
      if (facts.length > 0) {
        structuredFactsStream = '\n\n## STRUCTURED FACT MEMORY (Authoritative)\n';
        structuredFactsStream += 'Use facts ONLY when the user asks about that topic. Do NOT volunteer unsolicited facts.\n';
        structuredFactsStream += 'Override conflicting info. If uncertain, say "Je n\'ai pas cette info". Never guess.\n\n';
        facts.forEach((f) => {
          structuredFactsStream += `- ${f.key}: ${f.value} (${f.source_type || 'unknown'}, priority ${f.priority})\n`;
        });
      }
    } catch (err) {
      console.warn('[EVA Chat] Structured facts failed:', err.message);
    }
  }

  // Memory context in stream mode (same as reply — memory_items + feedback)
  let memoryContextStream = '';
  if (ownerId) {
    try {
      const memoryItems = require('./services/memoryItemsService');
      const feedbackService = require('./services/feedbackService');
      const memoryService = require('./services/memoryService');
      const [items, feedback, legacyMemories] = await Promise.all([
        memoryItems.getMemoryItems(ownerId, 30),
        feedbackService.getRecentFeedback(ownerId, 10),
        memoryService.getMemories(ownerId, 15),
      ]);
      const lines = [];
      if (items.length > 0) {
        items.forEach((m) => {
          const label = m.kind === 'correction' ? '[CORRECTION]' : m.kind === 'preference' ? '[PRÉFÉRENCE]' : '[FACT]';
          lines.push(`- ${label} ${m.key} = ${m.value}`);
        });
      }
      if (feedback.length > 0) {
        feedback.forEach((f) => {
          if (f.feedback_type === 'correction' && f.corrected_text) {
            lines.push(`- Éviter: "${(f.original_text || '').slice(0, 60)}..." → Utiliser: "${(f.corrected_text || '').slice(0, 60)}..."`);
          } else if (f.feedback_type === 'thumbs_down' && f.original_text) {
            lines.push(`- Éviter: "${(f.original_text || '').slice(0, 80)}..."`);
          }
        });
      }
      if (legacyMemories.length > 0 && lines.length < 5) {
        legacyMemories.slice(0, 10).forEach((m) => lines.push(`- ${m.fact}`));
      }
      if (lines.length > 0) {
        memoryContextStream = '\n\n## PERSISTENT MEMORY\n' + lines.join('\n') + '\n';
      }
    } catch (err) {
      console.warn('[EVA Chat] Memory context failed:', err.message);
    }
  }

  // Calendar context in stream mode (skip if minimal)
  let calendarContextStream = '';
  if (ownerId && !isMinimalMessage(userMessage)) {
    try {
      const calSync = getCalendarSync();
      if (calSync) {
        const shouldInject = ALWAYS_INJECT_RECENT || CALENDAR_KEYWORDS.test(userMessage);
        if (shouldInject) {
          const events = await calSync.getUpcomingEvents(ownerId, 10, 14);
          calendarContextStream = '\n\n## Calendar (upcoming events)\n';
          if (events.length > 0) {
            calendarContextStream += 'Use these to answer questions about meetings, schedule, agenda. To delete an event, use delete_calendar_event with the event id.\n\n';
            events.forEach((ev, i) => {
              const start = new Date(ev.start_at);
              const fmt = ev.is_all_day
                ? start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                : start.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              calendarContextStream += `**Event ${i + 1}** (id: ${ev.id}): ${ev.title || '(no title)'} | ${fmt}${ev.location ? ` @ ${ev.location}` : ''}${ev.gmail_address ? ` [${ev.gmail_address}]` : ''}\n`;
            });
          } else {
            calendarContextStream += '(No events — sync Google Calendar in Settings > Data Sources to see upcoming events.)\n';
          }
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Calendar context lookup failed:', err.message);
    }
  }

  // Resolve Alice mode for stream (same logic as reply())
  let isAliceModeStream = process.env.EVA_ALICE_MODE === 'true';
  if (!isAliceModeStream && ownerId) {
    try {
      const { getAliceMode } = require('./services/settingsService');
      isAliceModeStream = await getAliceMode(ownerId);
    } catch (_) { /* settingsService may not export getAliceMode yet */ }
  }
  const streamBasePrompt = getSystemPromptBase(isAliceModeStream);
  let systemPrompt = streamBasePrompt + structuredFactsStream + memoryContextStream + emailContext + documentContext + calendarContextStream;
  // P4: Style / voice profile injection
  if (ownerId) {
    try {
      const { getStyleProfile } = require('./services/settingsService');
      const styleText = await getStyleProfile(ownerId);
      if (styleText) {
        systemPrompt += `\n\n## User's communication style (P4)\nMatch this tone and style when responding.\n${styleText}\n`;
      }
    } catch (err) {
      console.warn('[EVA Chat] Style profile lookup failed:', err.message);
    }
  }
  if (mode && MODE_HINTS[mode]) {
    systemPrompt += `\n\n## Current Mode: ${mode}\n${MODE_HINTS[mode]}`;
  }

  const contextWindow = Math.max(5, Math.min(100, Number(process.env.EVA_CONTEXT_WINDOW) || 25));
  const messages = [
    ...history.slice(-contextWindow).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const stream = client.messages.stream({
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

  return { stream, model };
}

/** True when we need reply() with tools (calendar, save_memory, create_draft) — stream has no tools */
function needsCalendarTools(message) {
  if (!message || typeof message !== 'string') return false;
  const m = message.trim();
  const calendarIntent = /ajout(e|er)\s+(mon|ma|le|la)?\s*(vol|vols|meeting|event)|add\s+(my|the)\s+(flight|meeting|event)|mets?\s+(au|dans)\s+(mon\s+)?calendrier|create\s+(event|calendar)|cre[eé]e?r?\s+(un\s+)?(e?v[eé]nement|event)/i.test(m)
    || (/\bvol\b.*\b(shanghai|pvg|dubai)\b|\b(flight|vol)\b.*\bcalendrier\b/i.test(m));
  const deleteCalendarIntent = /enl[eè]v(e|er)?\s+(le\s+)?(vol|meeting|event|rdv)|supprim(e|er)?\s+(le\s+)?(vol|meeting|event|rdv)|retir(e|er)?\s+(le\s+)?(vol|meeting|event|rdv)|cancel\s+(the\s+)?(flight|meeting|event)|delete\s+(the\s+)?(flight|meeting|event)/i.test(m);
  const memoryIntent = /retiens?\s+(que|ça)|note\s+(que|ça)|souviens?-toi|je\s+pr[eé]f[eè]re|j'aime\s+(pas\s+)?[a-z]|mon\s+(pr[eé]f[eè]rence|vol|meeting)\s+est|remember\s+that|note\s+that|i\s+prefer/i.test(m);
  const correctionIntent = /c'est\s+faux|non\s+c'est\s+le|corrige|tu\s+as\s+faux|rev[eé]rifie|je\s+te\s+corrige/i.test(m);
  const draftIntent = /r[eé]dig(e|er)?\s+(une?\s+)?(r[eé]ponse|email|mail)|r[eé]ponds?\s+(à|a)\s+(cet|ce)\s+email|draft\s+(a\s+)?reply|write\s+(an?\s+)?(email|reply)|envoie?\s+(une?\s+)?(r[eé]ponse|email)|r[eé]ponse\s+à\s+(cet|ce)\s+mail/i.test(m);
  return calendarIntent || deleteCalendarIntent || memoryIntent || correctionIntent || draftIntent;
}

module.exports = { reply, createReplyStream, parseCommand, getClient, EVA_SYSTEM, ALICE_SYSTEM, getSystemPromptBase, MODE_HINTS, needsCalendarTools };
