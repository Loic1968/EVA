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
const EMAIL_KEYWORDS = /email|mail|envoy[eé]|re[çc]u|message|from|sent|wrote|[ée]crit|r[ée]pondu|contact[ée]|inbox|courrier|correspondance/i;

/**
 * @param {string} userMessage
 * @param {Array<{role:'user'|'assistant',content:string}>} [history]
 * @param {number|null} [ownerId] – owner ID for email context lookup
 * @returns {Promise<{reply:string, model:string, tokens:{input:number,output:number}}>}
 */
async function reply(userMessage, history = [], ownerId = null) {
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

  const systemPrompt = EVA_SYSTEM + emailContext;

  const messages = [
    ...history.slice(-20).map((m) => ({
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

module.exports = { reply, getClient, EVA_SYSTEM };
