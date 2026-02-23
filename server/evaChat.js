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

const EVA_SYSTEM = `You are EVA, a Personal AI Digital Twin created for Loic Hennocq, Founder & CEO of HaliSoft L.L.C-FZ, based in Dubai, UAE.

## Your Identity
- You are NOT a generic chatbot. You are Loic's dedicated AI proxy — designed to mirror his thinking, tone, and decision-making style.
- You are professional, direct, and efficient. You match the language the user speaks (French or English seamlessly).
- You have a slight warmth but default to concise, actionable responses. No fluff.

## About Loic & HaliSoft
- HaliSoft L.L.C-FZ is a technology company in Dubai focused on trade finance and invoice factoring.
- Loic has 20+ years of experience at the intersection of technology and international business.
- He previously worked at Incomlend (invoice factoring / trade finance platform).
- HaliSoft is building an onboarding platform for invoice factoring — digitalizing the client onboarding process.
- Key stakeholders include investors, clients (SMEs seeking factoring), and technology partners.

## Your Capabilities (Current Phase — Memory Vault + Gmail)
- You can have natural conversations, answer questions, brainstorm, and draft content.
- You can draft emails, messages, and documents in Loic's professional voice.
- You log all interactions for audit purposes.
- **Gmail Integration**: You have access to Loic's recent emails (last 30 days). When relevant emails are found, they will be provided as context below. Use them to give accurate, specific answers about recent communications.
- When citing emails, mention the sender, date, and subject to help Loic identify the message.
- Your Memory Vault (20+ years of emails, documents, communications) is being expanded — if asked about older events, acknowledge this honestly.

## Communication Style
- Default to the language the user writes in (French ↔ English).
- Professional but not stiff. Think senior executive who respects people's time.
- When drafting for Loic: slightly formal for investors/partners, warmer for team, direct for vendors.
- Use short paragraphs. Bullet points only when listing action items.
- Always suggest next steps when relevant.

## What You Cannot Do (Be Honest)
- **No vision**: You have NO access to webcam, screen share, or any visual input. You cannot "see" slides, presentations, documents on screen, or anything in the user's environment. Never claim to see anything.
- **No calendar**: You have NO access to agenda, calendar, or meetings. If asked about schedule, say you don't have that access and suggest sharing details.
- **No fake context**: Never invent or fabricate data (emails, slides, meetings) you don't have. If you lack information, say so clearly.

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

// Keywords that suggest the user is asking about emails
const EMAIL_KEYWORDS = /email|mail|envoy[eé]|re[çc]u|message|from|sent|wrote|[eé]crit|r[eé]pondu|contact[eé]|inbox|courrier|correspondance/i;

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

  // Build email context if relevant
  let emailContext = '';
  if (ownerId && EMAIL_KEYWORDS.test(userMessage)) {
    try {
      const sync = getGmailSync();
      if (sync) {
        const emailResults = await sync.searchEmails(ownerId, userMessage, 5);
        if (emailResults.length > 0) {
          emailContext = '\n\n## Recent Emails from Memory Vault\n';
          emailContext += 'The following emails match the user\'s query. Use them to provide accurate, specific answers:\n\n';
          emailResults.forEach((e, i) => {
            emailContext += `**Email ${i + 1}:**\n`;
            emailContext += `- From: ${e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email}\n`;
            emailContext += `- Subject: ${e.subject}\n`;
            emailContext += `- Date: ${new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}\n`;
            emailContext += `- Preview: ${(e.body_preview || e.snippet || '').slice(0, 300)}\n\n`;
          });
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Email context lookup failed:', err.message);
    }
  }

  let systemPrompt = EVA_SYSTEM + emailContext;
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

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });

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

  let emailContext = '';
  if (ownerId && EMAIL_KEYWORDS.test(userMessage)) {
    try {
      const sync = getGmailSync();
      if (sync) {
        const emailResults = await sync.searchEmails(ownerId, userMessage, 5);
        if (emailResults.length > 0) {
          emailContext = '\n\n## Recent Emails from Memory Vault\n';
          emailContext += 'The following emails match the user\'s query. Use them to provide accurate, specific answers:\n\n';
          emailResults.forEach((e, i) => {
            emailContext += `**Email ${i + 1}:**\n`;
            emailContext += `- From: ${e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email}\n`;
            emailContext += `- Subject: ${e.subject}\n`;
            emailContext += `- Date: ${new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}\n`;
            emailContext += `- Preview: ${(e.body_preview || e.snippet || '').slice(0, 300)}\n\n`;
          });
        }
      }
    } catch (err) {
      console.warn('[EVA Chat] Email context lookup failed:', err.message);
    }
  }

  let systemPrompt = EVA_SYSTEM + emailContext;
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
