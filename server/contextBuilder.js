// Keywords for query-aware retrieval (match evaChat.js)
const EMAIL_KEYWORDS = /email|mail|vol[s]?|vole|billet|avion|Shanghai|PVG|voyage|flight|ticket|emirates|etihad|reservation|confirmation|booking/i;
const DOCUMENT_KEYWORDS = /vol[s]?|vole|billet|avion|train|Shanghai|PVG|voyage|travel|flight|emirates|etihad|ticket|document|passport|horaire|heure|date|contrat|contract|proc[eé]dure|procedure|terme[s]?|terms|policy|politique|cv|r[eé]sum[eé]|resume|facture|invoice|devis|quote|memo|m[eé]moire|memory\s*vault/i;

function isMinimalMessage(msg) {
  const t = (msg || '').trim();
  return !t || t.length < 6;
}

// ── Simple TTL cache (avoids re-fetching Gmail/Calendar/Docs on rapid messages) ──
const _cache = new Map();
const CACHE_TTL_MS = 60_000; // 60 seconds

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _cache.delete(key); return undefined; }
  return entry.value;
}
function cacheSet(key, value) {
  _cache.set(key, { value, ts: Date.now() });
}

// ── Parallel fetchers (each returns its own block or '') ──

async function fetchFacts(ownerId) {
  const cacheKey = `facts:${ownerId}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const factsService = require('./services/factsService');
    const facts = await factsService.getFacts(ownerId, 50);
    cacheSet(cacheKey, facts);
    return facts;
  } catch (e) {
    console.warn('[EVA contextBuilder] Facts failed:', e.message);
    return [];
  }
}

async function fetchObjects(ownerId) {
  if (process.env.EVA_STRUCTURED_MEMORY !== 'true') return [];
  const cacheKey = `objects:${ownerId}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const objectsService = require('./services/objectsService');
    const objects = await objectsService.getActiveObjects(ownerId, 10);
    cacheSet(cacheKey, objects);
    return objects;
  } catch (e) {
    return [];
  }
}

async function fetchEmails(ownerId, userMessage, isFlightIntent) {
  const cacheKey = `emails:${ownerId}:${userMessage.slice(0, 60)}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const mcpClient = require('./services/mcpClient');
    const useSearch = EMAIL_KEYWORDS.test(userMessage);

    if (mcpClient.isConnected()) {
      // MCP path
      const personalTools = require('./services/personalToolsService');
      const searchQuery = useSearch && isFlightIntent ? personalTools.buildFlightEmailQuery(userMessage) : userMessage;
      const result = useSearch
        ? await mcpClient.callTool('gmail.search', { owner_id: ownerId, query: searchQuery, limit: 8 })
        : await mcpClient.callTool('gmail.recent', { owner_id: ownerId, limit: 10, preview_chars: 5000 });
      const emails = result.ok ? (result.data?.emails || []) : [];
      cacheSet(cacheKey, emails);
      return emails;
    }

    // Fallback: direct service call
    const gmailSync = require('./services/gmailSync');
    if (!gmailSync) return [];
    const personalTools = require('./services/personalToolsService');
    const searchQuery = useSearch && isFlightIntent ? personalTools.buildFlightEmailQuery(userMessage) : userMessage;
    const emails = useSearch && gmailSync.searchEmails
      ? await gmailSync.searchEmails(ownerId, searchQuery, 8, null, 'all')
      : await gmailSync.getRecentEmails(ownerId, 10, 5000);
    cacheSet(cacheKey, emails);
    return emails;
  } catch (e) {
    console.warn('[EVA contextBuilder] Emails failed:', e.message);
    return [];
  }
}

async function fetchDocuments(ownerId, userMessage, isFlightIntent) {
  const cacheKey = `docs:${ownerId}:${userMessage.slice(0, 60)}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const personalTools = require('./services/personalToolsService');
    const searchQuery = userMessage + (isFlightIntent ? ' ' + (personalTools.buildFlightEmailQuery(userMessage) || 'itinerary flight') : '');
    const mcpClient = require('./services/mcpClient');

    if (mcpClient.isConnected()) {
      // MCP path
      const result = await mcpClient.callTool('docs.search', { owner_id: ownerId, query: searchQuery, top_k: 8 });
      let docs = result.ok ? (result.data?.results || []) : [];
      if (docs.length === 0) {
        const listResult = await mcpClient.callTool('docs.list', { owner_id: ownerId, limit: 5 });
        const recent = listResult.ok ? (listResult.data?.documents || []) : [];
        docs = recent.map((d) => ({ ...d, content_text: '', citation: { doc_id: d.doc_id, filename: d.filename, chunk_index: 0 } }));
      }
      cacheSet(cacheKey, docs);
      return docs;
    }

    // Fallback: direct service call
    const docProcessor = require('./services/documentProcessor');
    if (!docProcessor || !docProcessor.searchDocumentsWithCitations) return [];
    let docs = await docProcessor.searchDocumentsWithCitations(ownerId, searchQuery, 8);
    if (docs.length === 0) {
      const recent = await docProcessor.getRecentDocuments(ownerId, 5);
      docs = recent.map((d) => ({ ...d, citation: { doc_id: d.id, filename: d.filename, chunk_index: 0 } }));
    }
    cacheSet(cacheKey, docs);
    return docs;
  } catch (e) {
    console.warn('[EVA contextBuilder] Documents failed:', e.message);
    return [];
  }
}

async function fetchCalendar(ownerId, userMessage, isFlightIntent) {
  const cacheKey = `calendar:${ownerId}:${isFlightIntent}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const mcpClient = require('./services/mcpClient');
    const pts = require('./services/personalToolsService');
    const isFlight = pts.classifyIntent(userMessage) === pts.INTENTS.FLIGHT_QUESTION;

    if (mcpClient.isConnected()) {
      // MCP path
      const result = isFlight
        ? await mcpClient.callTool('calendar.search', { owner_id: ownerId, query: pts.buildFlightCalendarQuery(), days_before: 30, days_after: 90, limit: 20 })
        : await mcpClient.callTool('calendar.events', { owner_id: ownerId, days: 14, limit: 15 });
      const evList = result.ok ? (result.data?.events || []) : [];
      cacheSet(cacheKey, evList);
      return evList;
    }

    // Fallback: direct service call
    const calendarSync = require('./services/calendarSync');
    if (!calendarSync) return [];
    const events = (isFlight && calendarSync.searchCalendarEvents)
      ? await calendarSync.searchCalendarEvents(ownerId, pts.buildFlightCalendarQuery(), 30, 90, 20)
      : await calendarSync.getUpcomingEvents(ownerId, 10, 14);
    const evList = Array.isArray(events) ? events : [];
    cacheSet(cacheKey, evList);
    return evList;
  } catch (e) {
    console.warn('[EVA contextBuilder] Calendar failed:', e.message);
    return [];
  }
}

async function fetchWebSearch(userMessage) {
  try {
    const ws = require('./services/webSearchService');
    // Broad trigger: search for almost everything (like ChatGPT/Gemini)
    // Only skip greetings, acks, and pure personal-data questions
    const wantsWebSearch = ws && ws.shouldWebSearch && ws.shouldWebSearch(userMessage);
    if (!wantsWebSearch) return { wanted: false, results: null };

    const mcpClient = require('./services/mcpClient');
    const searchQuery = ws.extractQuery ? ws.extractQuery(userMessage) : userMessage;
    const topic = (ws.isNewsQuery && ws.isNewsQuery(userMessage)) ? 'news' : 'general';

    if (mcpClient.isConnected()) {
      // MCP path
      const toolName = topic === 'news' ? 'web.search_news' : 'web.search';
      const result = await mcpClient.callTool(toolName, { query: searchQuery, max_results: 5 });
      if (result.ok && result.data?.results?.length > 0) {
        const formatted = result.data.results.map(r => `- **${r.title}** (${r.url})\n  ${r.content || ''}`).join('\n');
        return { wanted: true, results: formatted };
      }
      return { wanted: true, results: null };
    }

    // Fallback: direct service call
    if (!ws.isAvailable || !ws.isAvailable()) return { wanted: true, results: null };
    const data = await ws.search(searchQuery, { maxResults: 5, topic });
    const formatted = ws.formatForContext ? ws.formatForContext(data) : null;
    return { wanted: true, results: formatted };
  } catch (e) {
    console.warn('[EVA contextBuilder] Web search failed:', e.message);
    return { wanted: true, results: null };
  }
}

// ── Format helpers ──

function formatFacts(facts) {
  const parts = [];
  const corrections = facts.filter((f) => (f.source_type || '').toLowerCase() === 'correction');
  if (corrections.length > 0) {
    parts.push('## Corrections (user-confirmed)');
    corrections.forEach((f) => parts.push(`- ${f.key}: ${f.value}`));
    parts.push('');
  }
  const otherFacts = facts.filter((f) => (f.source_type || '').toLowerCase() !== 'correction');
  if (otherFacts.length > 0) {
    parts.push('## Structured facts');
    otherFacts.forEach((f) => parts.push(`- ${f.key}: ${f.value} (${f.source_type || 'unknown'})`));
    parts.push('');
  }
  return parts.join('\n');
}

function formatObjects(objects) {
  if (!objects.length) return '';
  const lines = ['## Active matters'];
  objects.forEach((o) => {
    const meta = o.metadata || {};
    const status = o.status || meta.status || '—';
    const next = meta.next_action || '—';
    lines.push(`- ${o.object_type}: ${o.name || o.object_type} | status: ${status} | next: ${next}`);
  });
  lines.push('');
  return lines.join('\n');
}

function formatEmails(emails) {
  if (!emails.length) return '';
  const lines = ['## Emails'];
  emails.forEach((e, i) => {
    const from = e.from_name ? `${e.from_name} <${e.from_email}>` : (e.from_email || '—');
    const body = (e.body_preview || e.snippet || '').trim();
    lines.push(`**Email ${i + 1}:** ${e.subject || '(no subject)'}`);
    lines.push(`From: ${from} | Date: ${e.received_at ? new Date(e.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`);
    if (e.thread_id) lines.push(`thread_id: ${e.thread_id}`);
    lines.push(`Content:\n${body || '(empty)'}\n`);
  });
  return lines.join('\n');
}

function formatDocuments(docs, userMessage) {
  if (!docs.length) return '';
  const isFlightQuery = /vol[s]?|vole|avion|billet|flight|ticket|Shanghai|emirates|etihad|horaire|heure/i.test(userMessage);
  const charLimit = isFlightQuery ? 15000 : 3000;
  const lines = ['## Documents'];
  docs.forEach((d) => {
    const text = (d.content_text || d.content || d.content_preview || '').slice(0, charLimit);
    const cite = d.citation ? ` [Source: ${d.filename}, section ${(d.citation.chunk_index ?? 0) + 1}]` : '';
    lines.push(`**${d.filename}**${cite}:\n${text || '(no text)'}\n`);
  });
  return lines.join('\n');
}

function formatCalendar(events) {
  if (!events.length) return '';
  const lines = ['## Calendar'];
  events.forEach((ev, i) => {
    const start = ev.start_at ? new Date(ev.start_at) : null;
    const fmt = start && ev.is_all_day
      ? start.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
      : start ? start.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    lines.push(`- ${ev.title || '(no title)'} | ${fmt}${ev.location ? ` @ ${ev.location}` : ''}`);
  });
  lines.push('');
  return lines.join('\n');
}

/**
 * Smart context builder — PARALLEL version.
 * All I/O runs concurrently via Promise.allSettled (3-4x faster).
 */
async function buildContext({ ownerId, userMessage, history = [], isSmartContext = true, isConversationLearning = true }) {
  if (!ownerId) return { context: '' };

  const skipHeavyContext = isMinimalMessage(userMessage) || !isSmartContext;
  const personalTools = require('./services/personalToolsService');
  const isFlightIntent = personalTools.classifyIntent(userMessage) === personalTools.INTENTS.FLIGHT_QUESTION;

  // ── Launch ALL fetches in parallel ──
  const [factsResult, objectsResult, emailsResult, docsResult, calendarResult, webResult] =
    await Promise.allSettled([
      fetchFacts(ownerId),
      fetchObjects(ownerId),
      skipHeavyContext ? [] : fetchEmails(ownerId, userMessage, isFlightIntent),
      skipHeavyContext ? [] : fetchDocuments(ownerId, userMessage, isFlightIntent),
      skipHeavyContext ? [] : fetchCalendar(ownerId, userMessage, isFlightIntent),
      skipHeavyContext ? { wanted: false, results: null } : fetchWebSearch(userMessage),
    ]);

  // ── Collect results (fulfilled or empty fallback) ──
  const facts = factsResult.status === 'fulfilled' ? factsResult.value : [];
  const objects = objectsResult.status === 'fulfilled' ? objectsResult.value : [];
  const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : [];
  const docs = docsResult.status === 'fulfilled' ? docsResult.value : [];
  const events = calendarResult.status === 'fulfilled' ? calendarResult.value : [];
  const web = webResult.status === 'fulfilled' ? webResult.value : { wanted: false, results: null };

  // ── Assemble context ──
  const parts = [];

  // Facts & objects (fast, always included)
  const factsBlock = formatFacts(facts);
  if (factsBlock) parts.push(factsBlock);
  const objectsBlock = formatObjects(objects);
  if (objectsBlock) parts.push(objectsBlock);

  // Emails & documents (order: docs first if doc-related)
  const isDocRelated = DOCUMENT_KEYWORDS.test(userMessage);
  const emailsBlock = formatEmails(emails);
  const docsBlock = formatDocuments(docs, userMessage);

  if (isDocRelated && docsBlock) {
    parts.push(docsBlock.trim());
    if (emailsBlock) parts.push(emailsBlock.trim());
  } else {
    if (emailsBlock) parts.push(emailsBlock.trim());
    if (docsBlock) parts.push(docsBlock.trim());
  }

  // Calendar
  const calBlock = formatCalendar(events);
  if (calBlock) parts.push(calBlock.trim());

  // Web search
  if (web.results) {
    parts.push('## Web search\n' + web.results);
  }

  // Conversation history (gated by isConversationLearning toggle)
  const ctxWindow = Math.max(5, Math.min(50, Number(process.env.EVA_CONTEXT_WINDOW) || 25));
  const hist = isConversationLearning ? (history || []).slice(-ctxWindow) : [];
  if (hist.length > 0) {
    parts.push('## Conversation history');
    hist.forEach((m) => {
      const role = m.role === 'assistant' ? 'EVA' : 'User';
      parts.push(`${role}: ${(m.content || '').slice(0, 500)}`);
    });
  }

  const context = parts.join('\n').trim();
  return { context: context ? `\n\n${context}` : '' };
}

module.exports = { buildContext };
