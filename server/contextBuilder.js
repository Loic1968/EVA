// Keywords for query-aware retrieval (match evaChat.js)
const EMAIL_KEYWORDS = /email|mail|vol[s]?|vole|billet|avion|Shanghai|PVG|voyage|flight|ticket|emirates|etihad|reservation|confirmation|booking/i;
const DOCUMENT_KEYWORDS = /vol[s]?|vole|billet|avion|train|Shanghai|PVG|voyage|travel|flight|emirates|etihad|ticket|document|passport|horaire|heure|date/i;

function isMinimalMessage(msg) {
  const t = (msg || '').trim();
  return !t || t.length < 6;
}

/**
 * Smart context builder — used when EVA_SMART_CONTEXT=true.
 * Includes: facts, objects, emails, documents, calendar, web search.
 * Query-aware: uses search when user asks about flights/documents/emails.
 */
async function buildContext({ ownerId, userMessage, history = [] }) {
  if (!ownerId) return { context: '' };

  const parts = [];
  const skipHeavyContext = isMinimalMessage(userMessage);

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

    // 2. Structured facts (excluding corrections)
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
        // objectsService may not exist
      }
    }

    // 4. Emails — search when flight/travel keywords, else recent
    if (!skipHeavyContext) {
      const gmailSync = require('./services/gmailSync');
      if (gmailSync) {
        try {
          const useSearch = EMAIL_KEYWORDS.test(userMessage);
          const emails = useSearch && gmailSync.searchEmails
            ? await gmailSync.searchEmails(ownerId, userMessage, 5, null, 'all')
            : await gmailSync.getRecentEmails(ownerId, 10, 5000);
          if (emails.length > 0) {
            parts.push('## Emails (use to answer: flights, confirmations, who said what)');
            emails.forEach((e, i) => {
              const from = e.from_name ? `${e.from_name} <${e.from_email}>` : (e.from_email || '—');
              const body = (e.body_preview || e.snippet || '').trim();
              parts.push(`**Email ${i + 1}:** ${e.subject || '(no subject)'}`);
              parts.push(`From: ${from} | Date: ${e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`);
              if (e.thread_id) parts.push(`thread_id: ${e.thread_id}`);
              parts.push(`Content:\n${body || '(empty)'}\n`);
            });
            parts.push('');
          }
        } catch (e) {
          console.warn('[EVA contextBuilder] Emails failed:', e.message);
        }
      }
    }

    // 5. Documents — search when flight/travel keywords, else recent. Full content for tickets.
    if (!skipHeavyContext) {
      const docProcessor = require('./services/documentProcessor');
      if (docProcessor) {
        try {
          const useSearch = DOCUMENT_KEYWORDS.test(userMessage);
          let docs = useSearch
            ? await docProcessor.searchDocuments(ownerId, userMessage, 8)
            : await docProcessor.getRecentDocuments(ownerId, 5);
          if (docs.length === 0 && useSearch) docs = await docProcessor.getRecentDocuments(ownerId, 5);
          if (docs.length > 0) {
            const isFlightQuery = /vol[s]?|vole|avion|billet|flight|ticket|Shanghai|emirates|etihad|horaire|heure/i.test(userMessage);
            const charLimit = isFlightQuery ? 15000 : 3000; // Full content for flight questions
            parts.push('## Documents (Memory Vault) — TU AS ACCÈS : lis et réponds à partir du contenu ci-dessous.');
            docs.forEach((d, i) => {
              const text = (d.content_text || d.content_preview || '').slice(0, charLimit);
              parts.push(`**${d.filename}:**\n${text || '(no text)'}\n`);
            });
            parts.push('');
          } else if (/vol[s]?|vole|avion|billet|flight|ticket|Shanghai|heure|horaire|réservation|reservation/i.test(userMessage)) {
            parts.push('## Documents (vide)\nRéponse à donner si question sur vol/billet: "Je n\'ai pas cette info dans mes données. Connecte Gmail et Google Calendar (Paramètres > Données), ou uploade ton billet dans Documents."\n');
          }
        } catch (e) {
          console.warn('[EVA contextBuilder] Documents failed:', e.message);
        }
      }
    }

    // 6. Calendar — upcoming events (always when we have context, critical for flight times)
    if (!skipHeavyContext) {
      try {
        const calendarSync = require('./services/calendarSync');
        if (calendarSync && calendarSync.getUpcomingEvents) {
          const events = await calendarSync.getUpcomingEvents(ownerId, 10, 14);
          if (events && events.length > 0) {
            parts.push('## Calendar (upcoming events — use for flight times, meetings)');
            events.forEach((ev, i) => {
              const start = ev.start_at ? new Date(ev.start_at) : null;
              const fmt = start && ev.is_all_day
                ? start.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
                : start ? start.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
              parts.push(`- Event ${i + 1} (id: ${ev.id}): ${ev.title || '(no title)'} | ${fmt}${ev.location ? ` @ ${ev.location}` : ''}`);
            });
            parts.push('');
          } else if (/vol[s]?|vole|avion|billet|flight|Shanghai|heure|horaire|agenda|calendrier/i.test(userMessage)) {
            parts.push('## Calendar (vide)\nRéponse à donner si question sur vol/agenda: "Je n\'ai pas cette info. Connecte Google Calendar (Paramètres > Données) ou uploade ton billet dans Documents."\n');
          }
        }
      } catch (e) {
        console.warn('[EVA contextBuilder] Calendar failed:', e.message);
      }
    }

    // 7. Web search (Tavily) — news, real-time info
    if (!skipHeavyContext) {
      try {
        const ws = require('./services/webSearchService');
        const wantsWebSearch = ws && ws.needsWebSearch && ws.needsWebSearch(userMessage);
        if (wantsWebSearch && ws.isAvailable && ws.isAvailable()) {
          const query = ws.extractQuery ? ws.extractQuery(userMessage) : userMessage;
          const data = await ws.search(query, { maxResults: 5, topic: 'general' });
          const formatted = ws.formatForContext ? ws.formatForContext(data) : null;
          if (formatted) {
            parts.push('## Web search (latest info)');
            parts.push(formatted);
            parts.push('');
          } else {
            const cityMatch = (userMessage || '').match(/\b(dubai|duba[iï]|paris|london|shanghai|singapore|doha|new\s*york)\b/i);
            const city = cityMatch ? cityMatch[1] : '';
            parts.push(`## Web search (vide)\nRéponse OBLIGATOIRE: "Je n'ai pas trouvé d'infos récentes sur ${city || 'cette ville'}." JAMAIS de réponse générique (Expo, gratte-ciels, tourisme).\n`);
          }
        } else if (wantsWebSearch) {
          const cityMatch = (userMessage || '').match(/\b(dubai|duba[iï]|paris|london|shanghai|singapore|doha|new\s*york)\b/i);
          const city = cityMatch ? cityMatch[1] : '';
          parts.push(`## Web search (non configuré)\nRéponse OBLIGATOIRE: "Je n'ai pas trouvé d'infos récentes sur ${city || 'cette ville'}." JAMAIS de réponse générique.\n`);
        }
      } catch (e) {
        const ws = require('./services/webSearchService');
        const cityMatch = (userMessage || '').match(/\b(dubai|duba[iï]|paris|london|shanghai|singapore|doha|new\s*york)\b/i);
        if (ws && ws.needsWebSearch && ws.needsWebSearch(userMessage)) {
          const city = cityMatch ? cityMatch[1] : '';
          parts.push(`## Web search (erreur)\nRéponse OBLIGATOIRE: "Je n'ai pas trouvé d'infos récentes sur ${city || 'cette ville'}."\n`);
        }
        console.warn('[EVA contextBuilder] Web search failed:', e.message);
      }
    }

    // 8. Conversation history (last N messages)
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
