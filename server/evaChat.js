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
  return { command: null, message: t, mode: null };
}

const EVA_SYSTEM = `## COMPREHENSION (TOP PRIORITY — DO THIS FIRST)
1. Parse the user's question: What exactly are they asking? (person, topic, date, action?)
2. Search the context below (emails, documents). Match names, subjects, dates.
3. If you find the answer → give it with specifics (who, when, what). Cite source.
4. If you don't find it → say clearly "Je n'ai pas cette info" / "I don't have that". Never invent.
5. NEVER give vague or generic answers when they ask something specific. Go straight to the answer.

## DOCUMENT PRECISION (critical for billets, factures, invoices)
- When citing dates, amounts, or details from documents, use the EXACT value written in the document.
- If the bill says "2 mars" or "March 2nd" or "02/03", say 2 March — NEVER 1 March or another date.
- One day off is a critical error. Read the document text carefully and quote exactly.

You are EVA, a Personal AI Digital Twin for Loic Hennocq, Founder & CEO of HaliSoft L.L.C-FZ, Dubai.

## Your Name — Answer Directly
- "Comment tu t'appelles?" / "What's your name?" / "Qui es-tu?" / "C'est quoi ton nom?" → Answer: "EVA" or "Je m'appelle EVA". Nothing else.
- Do NOT say "merci c'est EVA" — that confuses "merci" with a name question. If they ask your name → say "EVA".

## Your Identity
- Loic's dedicated AI proxy. Professional, direct, efficient. Match the user's language (French ↔ English).
- NEVER say "required to stick to English" — always reply in French when the user writes in French.
- No fluff. No "Je comprends" / "I understand" as opener — go straight to the answer.

## About Loic & HaliSoft
- Trade finance, invoice factoring. 20+ years tech + international business. Ex-Incomlend. HaliSoft = onboarding platform for factoring.

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

// Keywords for travel/documents (vol, billet, Shanghai, document uploadé)
const DOCUMENT_KEYWORDS = /vol|billet|avion|train|Shanghai|PVG|voyage|travel|flight|lundi|mardi|mercredi|jeudi|vendredi|semaine|document|fichier|upload|upload[eé]/i;

// Keywords for calendar (agenda, meeting, vol, rendez-vous, schedule)
const CALENDAR_KEYWORDS = /agenda|calendrier|calendar|meeting|rendez-vous|rdv|r[eé]union|schedule|plann|event|[eé]v[eé]nement|prochain|vol|lundi|mardi|mercredi|jeudi|vendredi|demain|aujourd'hui|this week|add.*(to|au)|ajout(e|er).*(au|to)/i;

// Always inject recent context for owner (not just on keyword match) - helps comprehension
const ALWAYS_INJECT_RECENT = true;

const CALENDAR_TOOLS = [
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

async function executeCalendarTool(ownerId, name, input) {
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

  // Build document context: search on keywords or always inject recent
  let documentContext = '';
  if (ownerId) {
    try {
      const docProcessor = require('./services/documentProcessor');
      const shouldInject = ALWAYS_INJECT_RECENT || DOCUMENT_KEYWORDS.test(userMessage);
      if (shouldInject) {
        const docResults = DOCUMENT_KEYWORDS.test(userMessage)
          ? await docProcessor.searchDocuments(ownerId, userMessage, 8)
          : await docProcessor.getRecentDocuments(ownerId, 5);
        documentContext = '\n\n## Documents (Memory Vault)\n';
        if (docResults.length > 0) {
          documentContext += 'Use these for flights, tickets, billets, invoices, Shanghai, travel. Cite the document. For dates/amounts: use EXACT values from the text (e.g. if billet says 2 mars, say 2 mars — never approximate).\n\n';
          docResults.forEach((d, i) => {
            const text = (d.content_text || d.content_preview || '').slice(0, 2500);
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

  let systemPrompt = EVA_SYSTEM + emailContext + documentContext + calendarContext;
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
      const result = await executeCalendarTool(ownerId, block.name, block.input || {});
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

  // Document context: same logic as reply() — always inject recent OR search on keywords
  let documentContext = '';
  if (ownerId) {
    try {
      const docProcessor = require('./services/documentProcessor');
      const shouldInject = ALWAYS_INJECT_RECENT || DOCUMENT_KEYWORDS.test(userMessage);
      if (shouldInject) {
        const docResults = DOCUMENT_KEYWORDS.test(userMessage)
          ? await docProcessor.searchDocuments(ownerId, userMessage, 5)
          : await docProcessor.getRecentDocuments(ownerId, 5);
        documentContext = '\n\n## Documents (Memory Vault)\n';
        if (docResults.length > 0) {
          documentContext += 'Use these for flights, tickets, invoices, travel, etc. Cite the document. For dates/amounts: use EXACT values from the text (e.g. billet says 2 mars → say 2 mars, never 1 mars).\n\n';
          docResults.forEach((d, i) => {
            const text = (d.content_text || d.content_preview || '').slice(0, 2500);
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

  let systemPrompt = EVA_SYSTEM + emailContext + documentContext + calendarContextStream;
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

/** True when the message suggests adding an event to calendar — we need reply() with tools, not stream */
function needsCalendarTools(message) {
  if (!message || typeof message !== 'string') return false;
  const m = message.trim().toLowerCase();
  return /ajout(e|er)\s+(mon|ma|le|la)?\s*(vol|vols|meeting|event)|add\s+(my|the)\s+(flight|meeting|event)|mets?\s+(au|dans)\s+(mon\s+)?calendrier|create\s+(event|calendar)|cre[eé]e?r?\s+(un\s+)?(e?v[eé]nement|event)/i.test(m)
    || (/\bvol\b.*\b(shanghai|pvg|dubai)\b|\b(flight|vol)\b.*\bcalendrier\b/i.test(m));
}

module.exports = { reply, createReplyStream, parseCommand, getClient, EVA_SYSTEM, MODE_HINTS, needsCalendarTools };
