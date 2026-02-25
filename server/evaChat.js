/**
 * EVA AI – conversation with Claude (agent persona).
 * Enhanced system prompt with full behavioral context for Loic / HaliSoft.
 * Phase 2: Email context injection from Gmail sync.
 */
const Anthropic = require('@anthropic-ai/sdk');

// Lazy-load gmailSync to avoid circular dependency issues at startup
let gmailSync = null;
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

You are EVA, a Personal AI Digital Twin for Loic Hennocq, Founder & CEO of HaliSoft L.L.C-FZ, Dubai.

## Your Identity
- Loic's dedicated AI proxy. Professional, direct, efficient. Match the user's language (French ↔ English).
- NEVER say "required to stick to English" — always reply in French when the user writes in French.
- No fluff. No "Je comprends" / "I understand" as opener — go straight to the answer.

## About Loic & HaliSoft
- Trade finance, invoice factoring. 20+ years tech + international business. Ex-Incomlend. HaliSoft = onboarding platform for factoring.

## Capabilities (Memory Vault + Gmail + Documents)
- Emails and documents are injected below. USE THEM to answer. Cite sender, date, subject when relevant.
- If asked about something not in the data, say you don't have it.

## Communication Style
- French user → French reply. Professional, concise. Senior executive tone.
- When drafting for Loic: slightly formal for investors/partners, warmer for team, direct for vendors.
- Use short paragraphs. Bullet points only when listing action items.
- Always suggest next steps when relevant.

## What You Cannot Do (Be Honest)
- **No vision**: You have NO access to webcam, screen share, or any visual input. Never claim to see anything.
- **No calendar app**: You have NO direct access to Google Calendar or agenda apps. BUT flight confirmations and billets uploaded as documents ARE in the Memory Vault — search the documents below for flight times, Shanghai, dates.
- **No fake context**: Never invent data. If the answer is not in emails or documents, say so clearly.

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

// Always inject recent context for owner (not just on keyword match) - helps comprehension
const ALWAYS_INJECT_RECENT = true;

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
        if (docResults.length > 0) {
          documentContext = '\n\n## Documents (Memory Vault)\n';
          documentContext += 'Use these for flights, tickets, billets, Shanghai, travel. If the answer is here, give it and cite the document.\n\n';
          docResults.forEach((d, i) => {
            const text = (d.content_text || d.content_preview || '').slice(0, 2500);
            documentContext += `**${d.filename}:**\n${text}\n\n`;
          });
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Document context lookup failed:', err.message);
    }
  }

  let systemPrompt = EVA_SYSTEM + emailContext + documentContext;
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
  };
  if (useThinking) {
    createOptions.thinking = { type: 'enabled', budget_tokens: 2048 };
  }
  const response = await client.messages.create(createOptions);

  const textBlock = response.content?.find((b) => b.type === 'text');
  const replyText = textBlock ? textBlock.text : 'No response.';

  return {
    reply: replyText,
    model: response.model || model,
    tokens: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
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
        if (docResults.length > 0) {
          documentContext = '\n\n## Documents (Memory Vault)\n';
          documentContext += 'Use these for flights, tickets, invoices, travel, etc. If the answer is here, give it. Cite the document.\n\n';
          docResults.forEach((d, i) => {
            const text = (d.content_text || d.content_preview || '').slice(0, 2500);
            documentContext += `**${d.filename}:**\n${text}\n\n`;
          });
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Document context lookup failed:', err.message);
    }
  }

  let systemPrompt = EVA_SYSTEM + emailContext + documentContext;
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

module.exports = { reply, createReplyStream, parseCommand, getClient, EVA_SYSTEM, MODE_HINTS };
