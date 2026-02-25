/**
 * EVA AI – conversation with Claude (agent persona).
 * Enhanced system prompt with full behavioral context for Loic / HaliSoft.
 * Phase 2: Email context injection from Gmail sync.
 */
const Anthropic = require('@anthropic-ai/sdk');

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
  const rememberMatch = t.match(/^\/remember\s+(\S+)=(.+)$/is);
  if (rememberMatch) return { command: 'remember', key: rememberMatch[1].trim(), value: rememberMatch[2].trim(), message: '' };
  const correctMatch = t.match(/^\/correct\s+(\S+)=(.+)$/is);
  if (correctMatch) return { command: 'correct', key: correctMatch[1].trim(), value: correctMatch[2].trim(), message: '' };
  const forgetMatch = t.match(/^\/forget\s+(.+)$/is);
  if (forgetMatch) return { command: 'forget', key: forgetMatch[1].trim(), message: '' };
  if (/^\/memory\s*$/i.test(t)) return { command: 'memory', message: '' };
  return { command: null, message: t, mode: null };
}

const EVA_SYSTEM = `## RÈGLE D'OR (vérifie avant CHAQUE réponse)
Avant de dire "je note : tu as habité à X de Y à Z" : le message de l'utilisateur contient-il LITTÉRALEMENT ces infos? Si non (ex: il a dit "ciel", "bonjour", "...", rien) → RÉPONDS "Oui ?" UNIQUEMENT. N'invente rien.

## INTERDIT (ne dis JAMAIS)
- "Je comprends" — interdit. Remplacer par "D'accord." ou rien.
- "D'accord, je note : tu as habité à Singapour de 2004 à 2013" (ou toute plage d'années) — sauf si l'utilisateur a DIT ces mots dans son dernier message.

## MESSAGE VIDE OU MINIMAL (priorité)
- Mot seul sans question ni fait : "ciel", "ok", "d'accord", "...", "   ", rien → "Oui ?" Rien d'autre. Pas de "je note", pas de dates, pas de lieux inventés.
- NE JAMAIS inventer une réponse quand il n'a rien demandé. Pas d'analyse de documents, pas d'inférences.

## RÉSUMÉ DE DOCUMENT vs ÉNONCÉ (critique)
- "résume mon cv" / "resume mon cv" / "résume-moi mon CV" = l'utilisateur demande un RÉSUMÉ. Réponds "D'après ton CV : [points du document]." Cite le document. NE PAS utiliser save_memory ni "je note" — il n'a pas énoncé ces faits, il a demandé de lire le doc.
- save_memory = uniquement quand l'utilisateur ÉNONCE un fait ("j'ai habité 9 ans", "suis Marie"). Pas quand il demande "résume", "résumé", "summary", "what's in my CV".

## INTERPRÉTER CHAQUE MESSAGE (règle absolue)
Le texte peut être oral, incomplet, avec fautes. Interprète l'intention:
- "suis marie"/"suis Marie" → utilisateur dit s'appeler Marie → save_memory(key:"full_name", fact:"Marie") + "Noté."
- "né à lille"/"tu es née à lille"/"née à Lille France" → utilisateur dit être né à Lille → save_memory(key:"place_of_birth", fact:"Lille, France") + "Noté."
- "ma date de naissance"/"date naissance" → question sur DOB
- "mon vol"/"shanghai" → question sur vol
Si ambigu: pose UNE question courte. Ne dis jamais "je ne comprends pas" sans proposer une interprétation.

## QUESTION vs PAST vs FUTURE (critique)
- "combien de temps je vais habiter à X" = FUTUR (plans) → "Je n'ai pas cette info." ou demande précision. Ne réponds pas avec le passé.
- "combien de temps j'ai habité à X" = PASSÉ → cherche dans memory/documents.
- Si l'utilisateur dit "la question c'est [X]" → X EST la question. Réponds à X, pas à autre chose.
- Ne déduis JAMAIS des faits personnels (où il habitait, depuis quand) à partir de métadonnées de documents (ex: passeport délivré à Singapour). Utilise uniquement ce que l'utilisateur a DIT explicitement ou ce qui est écrit noir sur blanc dans un document qu'il partage.

## NE JAMAIS INVENTER (règle absolue)
- Sauve et répète UNIQUEMENT ce que l'utilisateur a DIT ou ce qui est écrit dans les documents. Rien d'autre.
- "de 2004 à 2013", "de X à Y" (plages d'années) : INTERDIT sauf si l'utilisateur a DIT ces années. Ne les invente jamais.
- Pas de lieux, durées, noms, ou faits ajoutés. Si l'utilisateur ne l'a pas dit et ce n'est pas dans un doc → ne le dis pas.
- "deux fois plus", "j'ai jamais dit ça" = l'utilisateur dit que tu as inventé → reconnais, ne "corrige" pas en inventant autre chose.

## COMPREHENSION
1. Parse: question ou énoncé? Question → cherche et réponds. Énoncé → save_memory + "Noté."
2. Cherche dans emails, documents, memory. Si trouvé → réponds précis. Si pas trouvé → "Je n'ai pas cette info." Jamais inventer.

## STRICTLY RESPONSIVE — Answer only what was asked
- "Bonjour" → "Bonjour." Rien d'autre. Ne lance pas d'analyse de documents ou d'inférences.
- One question = one focused answer. Never add "Au fait...", "D'ailleurs...", "D'après ton passeport tu étais à..." — forbidden.
- If they ask date de naissance / vol Shanghai → give ONLY that. No passport issuance, location, or "donc tu étais à X".

## DOCUMENT PRECISION (critical for billets, factures, invoices, identity docs)
- When citing dates, amounts, or details from documents, use the EXACT value written in the document.
- For identity documents: cite ONLY what is written (date de naissance, numéro, expiration). Do NOT infer lifestyle or location.
- INTERDIT: "Donc tu étais à Singapour", "tu étais encore à X à ce moment-là", "d'après ton passeport tu vivais à..." — le lieu d'émission du passeport ne prouve PAS où l'utilisateur habitait. Ne le dis jamais.
- Si on te demande où il habitait / date de départ: "Je n'ai pas cette info." Ne réponde pas avec des déductions du passeport.
- One day off is a critical error. Read the document text carefully and quote exactly.

## USER CORRECTION (highest priority)
- ONLY correct when the user gives an EXPLICIT replacement: "non c'est le 2 mars" ✓ → save "2 mars". "deux fois plus", "j'ai jamais dit ça", "tu inventes" ✗ → NOT a correction with new values. Do NOT invent another date/range.
- "j'ai jamais dit ça" / "je n'ai jamais dit" / "tu inventes" → "Désolé, j'ai inventé. Tu peux me donner la bonne info?" — ne sauve RIEN, ne réinvente pas.
- When they give explicit correction → "D'accord, je corrige : [their exact words]." + save_memory. Never repeat the wrong info.

You are EVA, a Personal AI Digital Twin for the user. The user may introduce themselves: "suis Marie", "je suis Loic" — save their name and treat them as the data owner. HaliSoft context: trade finance, invoice factoring.

## Your Name — Answer Directly
- "Comment tu t'appelles?" / "What's your name?" / "Qui es-tu?" / "C'est quoi ton nom?" → Answer: "EVA" or "Je m'appelle EVA". Nothing else.
- Do NOT say "merci c'est EVA" — that confuses "merci" with a name question. If they ask your name → say "EVA".

## Your Identity
- Loic's dedicated AI proxy. Professional, direct, efficient. Match the user's language (French ↔ English by default).
- When the user explicitly asks for a language — "réponds en chinois", "answer in Spanish", "in Arabic", "用中文回答" — reply in that language. You can respond in any language when requested.
- No fluff. NEVER say "Je comprends" — especially when the user corrects you. Say "D'accord, je note." and correct.

## About Loic & HaliSoft
- Trade finance, invoice factoring. 20+ years tech + international business. Ex-Incomlend. HaliSoft = onboarding platform for factoring.

## Understanding colloquial / elliptical French
- "suis Marie" / "suis Loic" = "je suis [name]" = user sharing their name → save_memory(key: "full_name", fact: "Marie")
- "né à Lille" / "née à Lille" / "tu es née à Lille" = often "je suis née à Lille" (typo or speech) = user sharing place of birth → save_memory(key: "place_of_birth", fact: "Lille, France")
- "j'habite Dubaï" / "vis à Paris" = user sharing where they live → save_memory
- Treat these as user sharing facts about themselves. Acknowledge briefly ("Noté. Je retiens que tu es Marie.") and save.

## Learning (save_memory) — CRITICAL: you have this tool. Use it.
- save_memory UNIQUEMENT quand l'utilisateur ÉNONCE un fait ("j'ai habité 9 ans", "suis Marie", "mon vol est le 2 mars"). PAS quand il demande "résume mon cv", "summary", "what's in my doc" — ce sont des requêtes, pas des énoncés.
- "résume mon cv" → réponds "D'après ton CV : [contenu]." Pas de save_memory, pas de "je note".
- When they DO share a fact → save_memory + "Noté." Do NOT say "Je ne retiens pas". You CAN retain.

## Capabilities (Memory Vault + Gmail + Documents + Calendar)
- **When sections appear below**: You CAN read and use them. ## Emails = search there. ## Documents = flight confirmations, billets, invoices. ## Calendar = upcoming events. Never say "je n'ai pas accès" when data is listed — you CAN see it.
- **When sections are empty**: Say "calendrier non synchronisé" or "aucun document dans le Memory Vault" — invite the user to sync/upload.
- SEARCH emails + documents first for flight confirmations, Shanghai, travel. If found → use create_calendar_event.
- If asked about something not in the data, say you don't have it.

## Communication Style
- French user → French reply. Professional, concise. Senior executive tone.
- When drafting for Loic: slightly formal for investors/partners, warmer for team, direct for vendors.
- Use short paragraphs. Bullet points only when listing action items.
- Always suggest next steps when relevant.

## What You Cannot Do (Be Honest)
- **No vision**: You have NO access to webcam, screen share, or any visual input. Never claim to see anything.
- **Calendar**: You CAN read events when ## Calendar appears below. You CAN add events via create_calendar_event. For "add my flight Shanghai" — search docs/emails for Shanghai, PVG, flight; if found use tool; if not, ask for date/time/title. NEVER say you cannot add to calendar.
- **No fake context**: Never invent data. If the answer is not in emails, documents, or calendar, say so clearly.

## What You Never Do
- Never pretend to have sent an email or message when you haven't.
- Never fabricate data or claim access to systems you don't have yet.
- Never sign contracts, commit to financial terms, or respond to legal correspondence autonomously.
- Never speak to family or personal contacts.`;

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY required for EVA chat');
  return new Anthropic({ apiKey: key.trim() });
}

// Keywords that suggest the user is asking about emails (widened for French)
const EMAIL_KEYWORDS = /email|mail|envoy[eé]|re[çc]u|message|from|sent|wrote|[eé]crit|r[eé]pondu|contact[eé]|inbox|courrier|correspondance|dernier|dit|demand[eé]|r[eé]ponse|qui m'a|pierre|jean|paul|marie/i;

// Keywords for travel/documents (vol, billet, Shanghai, passport, date de naissance, etc.)
const DOCUMENT_KEYWORDS = /vol|billet|avion|train|Shanghai|PVG|voyage|travel|flight|lundi|mardi|mercredi|jeudi|vendredi|semaine|document|fichier|upload|upload[eé]|passport|passeport|date\s*de\s*naissance|birth\s*date|naissance|identit[eé]|cni/i;

// Keywords for calendar (agenda, meeting, vol, rendez-vous, schedule)
const CALENDAR_KEYWORDS = /agenda|calendrier|calendar|meeting|rendez-vous|rdv|r[eé]union|schedule|plann|event|[eé]v[eé]nement|prochain|vol|lundi|mardi|mercredi|jeudi|vendredi|demain|aujourd'hui|this week|add.*(to|au)|ajout(e|er).*(au|to)/i;

// Always inject recent context for owner (not just on keyword match) - helps comprehension
const ALWAYS_INJECT_RECENT = true;

// Message trop court ou sans question/fait clair → ne pas injecter documents/facts (évite hallucination)
const MINIMAL_WORDS = /^(ciel|ok|oui|non|d\'accord|\.\.\.|bonjour|salut|hello|hi|yo|ah|euh|hum|quoi|merci|hein|voilà|voila)$/i;
function isMinimalMessage(msg) {
  const t = (msg || '').trim();
  if (!t || t.length < 6) return true; // vide, "ciel", "ok", "..."
  if (MINIMAL_WORDS.test(t)) return true; // mot seul sans intention claire
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
];

async function executeTool(ownerId, name, input) {
  if (name === 'save_memory') {
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
 * @returns {Promise<{reply:string, model:string, tokens:{input:number,output:number}}>}
 */
async function reply(userMessage, history = [], ownerId = null, mode = null) {
  const client = getClient();
  const model = process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514';

  // Build email context: search on keywords, or inject recent when ALWAYS_INJECT
  let emailContext = '';
  if (ownerId) {
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
            emailContext += 'Use these emails to answer questions about messages, who said what, etc. If the answer is here, cite it. If not, say you don\'t have that info.\n\n';
            emailResults.forEach((e, i) => {
              const isSent = Array.isArray(e.labels) ? e.labels.includes('SENT') : (e.labels && /"SENT"|'SENT'/.test(String(e.labels)));
              emailContext += `**Email ${i + 1}:**\n`;
              emailContext += isSent
                ? `- To: ${Array.isArray(e.to_emails) ? e.to_emails.join(', ') : e.to_emails || '—'}\n`
                : `- From: ${e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email}\n`;
              emailContext += `- Subject: ${e.subject}\n`;
              emailContext += `- Date: ${new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}\n`;
              emailContext += `- Preview: ${(e.body_preview || e.snippet || '').slice(0, 300)}\n\n`;
            });
          }
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Email context lookup failed:', err.message);
    }
  }

  // Build document context: search on keywords or always inject recent (skip if minimal — évite hallucination)
  let documentContext = '';
  if (ownerId && !isMinimalMessage(userMessage)) {
    try {
      const docProcessor = require('./services/documentProcessor');
      const shouldInject = ALWAYS_INJECT_RECENT || DOCUMENT_KEYWORDS.test(userMessage);
      if (shouldInject) {
        const useSearch = DOCUMENT_KEYWORDS.test(userMessage);
        let docResults = useSearch
          ? await docProcessor.searchDocuments(ownerId, userMessage, 8)
          : await docProcessor.getRecentDocuments(ownerId, 5);
        // Fallback: if search returns nothing, try recent (e.g. query too short)
        if (docResults.length === 0 && useSearch) {
          docResults = await docProcessor.getRecentDocuments(ownerId, 5);
        }
        documentContext = '\n\n## Documents (Memory Vault)\n';
        if (docResults.length > 0) {
          documentContext += 'Use these for flights, tickets, billets, invoices, Shanghai, travel. Cite the document. For dates: use EXACT values (2 mars not 1 mars). Check --- FLIGHT DATES --- block if present.\n\n';
          docResults.forEach((d, i) => {
            const text = (d.content_text || d.content_preview || '').slice(0, 20000);
            documentContext += `**${d.filename}:**\n${text}\n\n`;
          });
        } else {
          documentContext += '(No documents found. User can upload in Documents page.)\n';
          if (process.env.EVA_DEBUG === 'true') {
            const stats = await docProcessor.getDocumentStats(ownerId);
            console.warn('[EVA Chat] No documents for owner', ownerId, '| stats:', JSON.stringify(stats), '| Tip: Re-index documents in Documents page if status is uploaded/error');
          }
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

  // Calendar context: upcoming events when keywords match or always inject
  let calendarContext = '';
  if (ownerId) {
    try {
      const calSync = getCalendarSync();
      if (calSync) {
        const shouldInject = ALWAYS_INJECT_RECENT || CALENDAR_KEYWORDS.test(userMessage);
        if (shouldInject) {
          const events = await calSync.getUpcomingEvents(ownerId, 10, 14);
          calendarContext = '\n\n## Calendar (upcoming events)\n';
          if (events.length > 0) {
            calendarContext += 'Use these to answer questions about meetings, schedule, agenda.\n\n';
            events.forEach((ev, i) => {
              const start = new Date(ev.start_at);
              const fmt = ev.is_all_day
                ? start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                : start.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              calendarContext += `**Event ${i + 1}:** ${ev.title || '(no title)'} | ${fmt}${ev.location ? ` @ ${ev.location}` : ''}${ev.gmail_address ? ` [${ev.gmail_address}]` : ''}\n`;
            });
          } else {
            calendarContext += '(No events — sync Google Calendar in Settings > Data Sources to see upcoming events.)\n';
          }
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Calendar context lookup failed:', err.message);
    }
  }

  let systemPrompt = EVA_SYSTEM + structuredFactsContext + memoryContext + emailContext + documentContext + calendarContext;
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
    max_tokens: 2048,
    system: systemPrompt,
    messages,
    tools: ownerId ? CALENDAR_TOOLS : [],
  };
  if (useThinking) {
    createOptions.thinking = { type: 'enabled', budget_tokens: 2048 };
  }

  let response;
  let currentMessages = [...messages];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const maxToolRounds = 3;
  let round = 0;

  while (round < maxToolRounds) {
    response = await client.messages.create({ ...createOptions, messages: currentMessages });
    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    const toolUseBlocks = (response.content || []).filter((b) => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    const toolResults = [];
    for (const block of toolUseBlocks) {
      const result = await executeTool(ownerId, block.name, block.input || {});
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ];
    round++;
  }

  const textBlock = response.content?.find((b) => b.type === 'text');
  const replyText = textBlock ? textBlock.text : 'No response.';

  return {
    reply: replyText,
    model: response.model || model,
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

  // Email context: same logic as reply() — always inject recent OR search on keywords
  let emailContext = '';
  if (ownerId) {
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
            emailContext += 'Use these emails to answer. Cite sender, date, subject when relevant.\n\n';
            emailResults.forEach((e, i) => {
              const isSent = Array.isArray(e.labels) ? e.labels.includes('SENT') : (e.labels && /"SENT"|'SENT'/.test(String(e.labels)));
              emailContext += `**Email ${i + 1}:**\n`;
              emailContext += isSent
                ? `- To: ${Array.isArray(e.to_emails) ? e.to_emails.join(', ') : e.to_emails || '—'}\n`
                : `- From: ${e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email}\n`;
              emailContext += `- Subject: ${e.subject}\n`;
              emailContext += `- Date: ${new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}\n`;
              emailContext += `- Preview: ${(e.body_preview || e.snippet || '').slice(0, 300)}\n\n`;
            });
          }
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Email context lookup failed:', err.message);
    }
  }

  // Document context: same logic as reply() — skip if minimal (évite hallucination)
  let documentContext = '';
  if (ownerId && !isMinimalMessage(userMessage)) {
    try {
      const docProcessor = require('./services/documentProcessor');
      const shouldInject = ALWAYS_INJECT_RECENT || DOCUMENT_KEYWORDS.test(userMessage);
      if (shouldInject) {
        const useSearch = DOCUMENT_KEYWORDS.test(userMessage);
        let docResults = useSearch
          ? await docProcessor.searchDocuments(ownerId, userMessage, 5)
          : await docProcessor.getRecentDocuments(ownerId, 5);
        if (docResults.length === 0 && useSearch) {
          docResults = await docProcessor.getRecentDocuments(ownerId, 5);
        }
        documentContext = '\n\n## Documents (Memory Vault)\n';
        if (docResults.length > 0) {
          documentContext += 'Use these for flights, tickets, invoices, travel, etc. Cite the document. For dates: use EXACT values (2 mars not 1 mars). Check --- FLIGHT DATES --- block if present.\n\n';
          docResults.forEach((d, i) => {
            const text = (d.content_text || d.content_preview || '').slice(0, 20000);
            documentContext += `**${d.filename}:**\n${text}\n\n`;
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

  // Calendar context in stream mode
  let calendarContextStream = '';
  if (ownerId) {
    try {
      const calSync = getCalendarSync();
      if (calSync) {
        const shouldInject = ALWAYS_INJECT_RECENT || CALENDAR_KEYWORDS.test(userMessage);
        if (shouldInject) {
          const events = await calSync.getUpcomingEvents(ownerId, 10, 14);
          calendarContextStream = '\n\n## Calendar (upcoming events)\n';
          if (events.length > 0) {
            calendarContextStream += 'Use these to answer questions about meetings, schedule, agenda.\n\n';
            events.forEach((ev, i) => {
              const start = new Date(ev.start_at);
              const fmt = ev.is_all_day
                ? start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                : start.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              calendarContextStream += `**Event ${i + 1}:** ${ev.title || '(no title)'} | ${fmt}${ev.location ? ` @ ${ev.location}` : ''}${ev.gmail_address ? ` [${ev.gmail_address}]` : ''}\n`;
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

  let systemPrompt = EVA_SYSTEM + structuredFactsStream + memoryContextStream + emailContext + documentContext + calendarContextStream;
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

/** True when we need reply() with tools (calendar or save_memory) — stream has no tools */
function needsCalendarTools(message) {
  if (!message || typeof message !== 'string') return false;
  const m = message.trim();
  const calendarIntent = /ajout(e|er)\s+(mon|ma|le|la)?\s*(vol|vols|meeting|event)|add\s+(my|the)\s+(flight|meeting|event)|mets?\s+(au|dans)\s+(mon\s+)?calendrier|create\s+(event|calendar)|cre[eé]e?r?\s+(un\s+)?(e?v[eé]nement|event)/i.test(m)
    || (/\bvol\b.*\b(shanghai|pvg|dubai)\b|\b(flight|vol)\b.*\bcalendrier\b/i.test(m));
  const memoryIntent = /retiens?\s+(que|ça)|note\s+(que|ça)|souviens?-toi|je\s+pr[eé]f[eè]re|j'aime\s+(pas\s+)?[a-z]|mon\s+(pr[eé]f[eè]rence|vol|meeting)\s+est|remember\s+that|note\s+that|i\s+prefer/i.test(m);
  const correctionIntent = /c'est\s+faux|non\s+c'est\s+le|corrige|tu\s+as\s+faux|rev[eé]rifie|je\s+te\s+corrige/i.test(m);
  return calendarIntent || memoryIntent || correctionIntent;
}

module.exports = { reply, createReplyStream, parseCommand, getClient, EVA_SYSTEM, MODE_HINTS, needsCalendarTools };
