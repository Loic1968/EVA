// Keywords for query-aware retrieval (match evaChat.js)
const EMAIL_KEYWORDS = /email|mail|vol[s]?|vole|billet|avion|Shanghai|PVG|voyage|flight|ticket|emirates|etihad|reservation|confirmation|booking/i;
const DOCUMENT_KEYWORDS = /vol[s]?|vole|billet|avion|train|Shanghai|PVG|voyage|travel|flight|emirates|etihad|ticket|document|passport|horaire|heure|date|contrat|contract|proc[eé]dure|procedure|terme[s]?|terms|policy|politique|cv|r[eé]sum[eé]|resume|facture|invoice|devis|quote|memo|m[eé]moire|memory\s*vault/i;

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
  const personalTools = require('./services/personalToolsService');
  const isFlightIntent = personalTools.classifyIntent(userMessage) === personalTools.INTENTS.FLIGHT_QUESTION;

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

    // 4 & 5. Emails + Documents — DOCS-FIRST: when doc-related, Documents BEFORE Emails
    const isDocRelated = DOCUMENT_KEYWORDS.test(userMessage);
    let emailsBlock = '';
    let docsBlock = '';

    if (!skipHeavyContext) {
      const gmailSync = require('./services/gmailSync');
      if (gmailSync) {
        try {
          const useSearch = EMAIL_KEYWORDS.test(userMessage);
          const searchQuery = useSearch && isFlightIntent ? personalTools.buildFlightEmailQuery(userMessage) : userMessage;
          const emails = useSearch && gmailSync.searchEmails
            ? await gmailSync.searchEmails(ownerId, searchQuery, 8, null, 'all')
            : await gmailSync.getRecentEmails(ownerId, 10, 5000);
          if (emails.length > 0) {
            const lines = ['## Emails (use to answer: flights, confirmations, who said what)'];
            emails.forEach((e, i) => {
              const from = e.from_name ? `${e.from_name} <${e.from_email}>` : (e.from_email || '—');
              const body = (e.body_preview || e.snippet || '').trim();
              lines.push(`**Email ${i + 1}:** ${e.subject || '(no subject)'}`);
              lines.push(`From: ${from} | Date: ${e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`);
              if (e.thread_id) lines.push(`thread_id: ${e.thread_id}`);
              lines.push(`Content:\n${body || '(empty)'}\n`);
            });
            emailsBlock = lines.join('\n') + '\n';
          }
        } catch (e) {
          console.warn('[EVA contextBuilder] Emails failed:', e.message);
        }
      }

      const docProcessor = require('./services/documentProcessor');
      if (docProcessor && docProcessor.searchDocumentsWithCitations) {
        try {
          const searchQuery = userMessage + (isFlightIntent ? ' ' + (personalTools.buildFlightEmailQuery(userMessage) || 'itinerary flight') : '');
          let docs = await docProcessor.searchDocumentsWithCitations(ownerId, searchQuery, 8);
          if (docs.length === 0) {
            const recent = await docProcessor.getRecentDocuments(ownerId, 5);
            docs = recent.map((d) => ({ ...d, citation: { doc_id: d.id, filename: d.filename, chunk_index: 0 } }));
          }
          if (docs.length > 0) {
            const isFlightQuery = /vol[s]?|vole|avion|billet|flight|ticket|Shanghai|emirates|etihad|horaire|heure/i.test(userMessage);
            const charLimit = isFlightQuery ? 15000 : 3000;
            const lines = ['## Documents (Memory Vault) — DOCS-FIRST : réponds à partir du contenu. Cite (Source: filename, section N).'];
            docs.forEach((d) => {
              const text = (d.content_text || d.content_preview || '').slice(0, charLimit);
              const cite = d.citation ? ` [Source: ${d.filename}, section ${(d.citation.chunk_index ?? 0) + 1}]` : '';
              lines.push(`**${d.filename}**${cite}:\n${text || '(no text)'}\n`);
            });
            docsBlock = lines.join('\n') + '\n';
          } else if (isDocRelated) {
            docsBlock = '## Documents (vide)\nRéponse: "Je n\'ai pas cette info dans tes documents. Uploade-les dans Documents, ou connecte Gmail/Calendar (Paramètres > Données)."\n';
          }
        } catch (e) {
          console.warn('[EVA contextBuilder] Documents failed:', e.message);
        }
      }

      if (isDocRelated && docsBlock) {
        parts.push(docsBlock.trim());
        if (emailsBlock) parts.push(emailsBlock.trim());
      } else {
        if (emailsBlock) parts.push(emailsBlock.trim());
        if (docsBlock) parts.push(docsBlock.trim());
      }
    }

    // 6. Calendar — search for flights (±30/90d) or upcoming events
    if (!skipHeavyContext) {
      try {
        const calendarSync = require('./services/calendarSync');
        const pts = require('./services/personalToolsService');
        const isFlight = pts.classifyIntent(userMessage) === pts.INTENTS.FLIGHT_QUESTION;
        if (calendarSync) {
          const events = (isFlight && calendarSync.searchCalendarEvents)
            ? await calendarSync.searchCalendarEvents(ownerId, pts.buildFlightCalendarQuery(), 30, 90, 20)
            : await calendarSync.getUpcomingEvents(ownerId, 10, 14);
          const evList = Array.isArray(events) ? events : [];
          if (evList.length > 0) {
            parts.push('## Calendar (upcoming events — use for flight times, meetings)');
            evList.forEach((ev, i) => {
              const start = ev.start_at ? new Date(ev.start_at) : null;
              const fmt = start && ev.is_all_day
                ? start.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
                : start ? start.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
              parts.push(`- Event ${i + 1} (id: ${ev.id}): ${ev.title || '(no title)'} | ${fmt}${ev.location ? ` @ ${ev.location}` : ''}`);
            });
            parts.push('');
          } else if (isFlight || /vol[s]?|vole|avion|billet|flight|Shanghai|heure|horaire|agenda|calendrier/i.test(userMessage)) {
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
          const topic = (ws.isNewsQuery && ws.isNewsQuery(userMessage)) ? 'news' : 'general';
          const data = await ws.search(query, { maxResults: 5, topic });
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
