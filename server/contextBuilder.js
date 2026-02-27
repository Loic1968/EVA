/**
 * Smart context builder — used when EVA_SMART_CONTEXT=true.
 * Builds context STRICTLY in order. Never injects full email bodies.
 */
async function buildContext({ ownerId, userMessage, history = [] }) {
  if (!ownerId) return { context: '' };

  const parts = [];

  try {
    // 1. Corrections (highest priority)
    const factsService = require('./services/factsService');
    const facts = await factsService.getFacts(ownerId, 50);
    const corrections = facts.filter((f) => (f.source_type || '').toLowerCase() === 'correction');
    if (corrections.length > 0) {
      parts.push('## Corrections (user-confirmed — override everything)');
      corrections.forEach((f) => parts.push(`- ${f.key}: ${f.value}`));
      parts.push('');
    }

    // 2. Structured facts (excluding corrections, already above)
    const otherFacts = facts.filter((f) => (f.source_type || '').toLowerCase() !== 'correction');
    if (otherFacts.length > 0) {
      parts.push('## Structured facts');
      otherFacts.forEach((f) => parts.push(`- ${f.key}: ${f.value} (${f.source_type || 'unknown'})`));
      parts.push('');
    }

    // 3. Active objects state
    if (process.env.EVA_STRUCTURED_MEMORY === 'true') {
      try {
        const objectsService = require('./services/objectsService');
        const objects = await objectsService.getActiveObjects(ownerId, 10);
        if (objects.length > 0) {
          parts.push('## Active matters');
          objects.forEach((o) => {
            const meta = o.metadata || {};
            const status = o.status || meta.status || '—';
            const next = meta.next_action || '—';
            parts.push(`- ${o.object_type}: ${o.name || o.object_type} | status: ${status} | next: ${next}`);
          });
          parts.push('');
        }
      } catch (e) {
        // objectsService may not exist or table missing
      }
    }

    // 4. Relevant emails — TOP 20 with full body content
    const gmailSync = require('./services/gmailSync');
    if (gmailSync && gmailSync.getRecentEmails) {
      try {
        const BODY_CHARS_PER_EMAIL = 5000;
        const emails = await gmailSync.getRecentEmails(ownerId, 20, BODY_CHARS_PER_EMAIL);
        if (emails.length > 0) {
          parts.push('## Emails (read full content — use to answer questions)');
          emails.forEach((e, i) => {
            const from = e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email;
            const body = (e.body_preview || e.snippet || '').trim();
            parts.push(`**Email ${i + 1}:** ${e.subject}`);
            parts.push(`From: ${from} | Date: ${e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`);
            parts.push(`Content:\n${body || '(empty)'}\n`);
          });
          parts.push('');
        }
      } catch (e) {
        // Gmail not connected
      }
    }

    // 5. Relevant documents — TOP 3 summarized
    const docProcessor = require('./services/documentProcessor');
    if (docProcessor) {
      try {
        const docs = await docProcessor.getRecentDocuments(ownerId, 3);
        if (docs.length > 0) {
          parts.push('## Documents (summarized)');
          docs.forEach((d, i) => {
            const preview = (d.content_text || d.content_preview || '').slice(0, 500);
            parts.push(`**${d.filename}:** ${preview}...`);
          });
          parts.push('');
        }
      } catch (e) {
        // Documents not available
      }
    }

    // 6. Conversation history (last N messages)
    const ctxWindow = Math.max(5, Math.min(50, Number(process.env.EVA_CONTEXT_WINDOW) || 25));
    const hist = (history || []).slice(-ctxWindow);
    if (hist.length > 0) {
      parts.push('## Conversation history');
      hist.forEach((m) => {
        const role = m.role === 'assistant' ? 'EVA' : 'User';
        parts.push(`${role}: ${(m.content || '').slice(0, 500)}`);
      });
    }
  } catch (e) {
    console.warn('[EVA contextBuilder]', e.message);
  }

  const context = parts.join('\n').trim();
  return { context: context ? `\n\n${context}` : '' };
}

module.exports = { buildContext };
