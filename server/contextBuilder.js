/**
 * Smart context builder — when EVA_SMART_CONTEXT=true.
 * Builds context in strict priority order with hard caps. No full bodies by default.
 * Read-only. No PII in logs.
 */
const DEFAULT_MAX_CHARS = 32000; // ~8K tokens safety margin

/**
 * Build structured context for EVA in strict order.
 * @param {object} opts
 * @param {number} opts.ownerId
 * @param {string} opts.userMessage
 * @param {Array<{role:string,content:string}>} opts.history
 * @returns {Promise<{context:string, sections:object}>}
 */
async function buildContext(opts) {
  const { ownerId, userMessage, history = [] } = opts;
  const maxChars = Math.min(50000, Number(process.env.EVA_CONTEXT_MAX_CHARS) || DEFAULT_MAX_CHARS);
  const contextWindow = Math.max(5, Math.min(100, Number(process.env.EVA_CONTEXT_WINDOW) || 30));
  const sections = {};
  let total = 0;

  const append = (label, text) => {
    if (!text || total >= maxChars) return;
    const chunk = `\n\n## ${label}\n${text}`;
    const len = chunk.length;
    if (total + len > maxChars) {
      const trim = text.slice(0, maxChars - total - len - 20) + '\n[...trimmed]';
      sections[label] = trim;
      total += (sections[label] + chunk).length;
      return;
    }
    sections[label] = text;
    total += chunk.length;
  };

  // 1) Corrections (highest priority) + feedback (à éviter)
  if (ownerId) {
    try {
      const memoryItems = require('./services/memoryItemsService');
      const feedbackService = require('./services/feedbackService');
      const [items, feedback] = await Promise.all([
        memoryItems.getMemoryItems(ownerId, 30),
        feedbackService.getRecentFeedback(ownerId, 8).catch(() => []),
      ]);
      const corrections = items.filter((m) => m.kind === 'correction');
      const lines = [];
      if (corrections.length > 0) {
        lines.push(...corrections.map((m) => `- ${m.key} = ${m.value}`));
      }
      feedback.filter((f) => f.feedback_type === 'correction' && f.corrected_text).forEach((f) => {
        lines.push(`- Éviter: "${(f.original_text || '').slice(0, 50)}..." → Utiliser: "${(f.corrected_text || '').slice(0, 50)}..."`);
      });
      if (lines.length > 0) append('CORRECTIONS (priorité maximale)', lines.join('\n'));
    } catch (_) {}
  }

  // 2) Authoritative facts
  if (ownerId && process.env.EVA_STRUCTURED_MEMORY === 'true') {
    try {
      const factsService = require('./services/factsService');
      const facts = await factsService.getFacts(ownerId, 50);
      if (facts.length > 0 && total < maxChars) {
        const lines = facts.map((f) => `- ${f.key}: ${f.value} (${f.source_type || 'fact'})`).join('\n');
        append('FAITS (authoritative)', lines);
      }
    } catch (_) {}
  }

  // 3) Relevant emails (TOP 5) summarized
  if (ownerId && total < maxChars) {
    try {
      const gmailSync = require('./services/gmailSync');
      const emails = await gmailSync.searchEmails(ownerId, userMessage, 5, null, 'all').catch(() => []);
      if (emails.length === 0) {
        const recent = await gmailSync.getRecentEmails(ownerId, 5).catch(() => []);
        if (recent.length > 0) {
          const lines = recent.map((e, i) => {
            const from = e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email;
            const preview = (e.body_preview || e.snippet || '').slice(0, 120).replace(/\n/g, ' ');
            return `[${i + 1}] De: ${from} | ${e.subject} | ${new Date(e.received_at).toLocaleDateString('fr-FR')}\n  ${preview}...`;
          }).join('\n\n');
          append('EMAILS (récents, 5)', lines);
        }
      } else {
        const lines = emails.map((e, i) => {
          const from = e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email;
          const preview = (e.body_preview || e.snippet || '').slice(0, 120).replace(/\n/g, ' ');
          return `[${i + 1}] De: ${from} | ${e.subject} | ${new Date(e.received_at).toLocaleDateString('fr-FR')}\n  ${preview}...`;
        }).join('\n\n');
        append('EMAILS (pertinents, 5)', lines);
      }
    } catch (_) {
      append('EMAILS', 'No relevant source found.');
    }
  }

  // 4) Relevant documents (TOP 3) summarized
  if (ownerId && total < maxChars) {
    try {
      const docProcessor = require('./services/documentProcessor');
      const useSearch = /vol|billet|passport|date|naissance|flight|document|fichier/i.test(userMessage);
      const docs = useSearch
        ? await docProcessor.searchDocuments(ownerId, userMessage, 3)
        : (await docProcessor.getRecentDocuments(ownerId, 3));
      if (docs.length === 0) {
        append('DOCUMENTS', 'No relevant source found.');
      } else {
        const lines = docs.map((d, i) => {
          const text = (d.content_text || d.content_preview || '').slice(0, 400).replace(/\n/g, ' ');
          return `[${i + 1}] ${d.filename}\n  ${text}...`;
        }).join('\n\n');
        append('DOCUMENTS (3)', lines);
      }
    } catch (_) {
      append('DOCUMENTS', 'No relevant source found.');
    }
  }

  // 5) Calendar (TOP 5) — 1 line per event
  if (ownerId && total < maxChars) {
    try {
      const calendarSync = require('./services/calendarSync');
      const events = await calendarSync.getUpcomingEvents(ownerId, 5, 14).catch(() => []);
      if (events.length > 0) {
        const lines = events.map((ev) => {
          const start = new Date(ev.start_at);
          const fmt = ev.is_all_day ? start.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : start.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          return `- ${ev.title || '(sans titre)'} | ${fmt}`;
        }).join('\n');
        append('CALENDRIER (5)', lines);
      }
    } catch (_) {}
  }

  // 6) Conversation history (last N messages)
  const hist = history.slice(-contextWindow);
  if (hist.length > 0 && total < maxChars) {
    const lines = hist.map((m) => `${m.role}: ${(m.content || '').slice(0, 500)}`).join('\n');
    append('HISTORIQUE CONVERSATION', lines);
  }

  const context = Object.entries(sections)
    .map(([label, text]) => `\n\n## ${label}\n${text}`)
    .join('');

  return { context, sections };
}

module.exports = { buildContext };
