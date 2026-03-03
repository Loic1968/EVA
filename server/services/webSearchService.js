/**
 * Tavily web search — real-time info for EVA.
 * Call when user asks for "latest", "news", "actualités", "quoi de neuf", etc.
 */
const TAVILY_API = 'https://api.tavily.com/search';

const TAVILY_TIMEOUT_MS = Number(process.env.TAVILY_TIMEOUT_MS) || 10000;

async function search(query, opts = {}) {
  const apiKey = (process.env.TAVILY_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY not set');
  }
  const {
    maxResults = 5,
    topic = 'general',
    searchDepth = 'basic',
    timeRange = null,
  } = opts;
  const body = {
    query: String(query).trim().slice(0, 500),
    max_results: Math.max(1, Math.min(20, maxResults)),
    search_depth: searchDepth,
    topic: ['general', 'news', 'finance'].includes(topic) ? topic : 'general',
  };
  if (timeRange && ['day', 'week', 'month', 'year'].includes(timeRange)) {
    body.time_range = timeRange;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);
  const res = await fetch(TAVILY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Tavily API ${res.status}: ${errText || res.statusText}`);
  }
  const data = await res.json();
  return data;
}

/**
 * Format Tavily results for EVA context injection.
 */
function formatForContext(data) {
  const results = data?.results || [];
  if (results.length === 0) return null;
  let text = '\n\n## Web search (infos à jour — cite les sources)\n';
  text += 'Utilise ces résultats pour répondre. Cite la source (titre + URL) quand tu t\'en sers. Si l\'info n\'est pas ici, dis "Je n\'ai pas trouvé d\'info récente".\n\n';
  results.forEach((r, i) => {
    const title = r.title || 'Source';
    const url = r.url || '';
    const content = (r.content || '').trim().slice(0, 1500);
    text += `**${i + 1}. ${title}**\n`;
    if (url) text += `URL: ${url}\n`;
    if (content) text += `${content}\n\n`;
  });
  return text;
}

/**
 * Check if user message suggests need for web search.
 * Includes: news, flights (vols Dubai NY), real-time info.
 */
const NEWS_KEYWORDS = /derni[eè]res?\s*infos?|actualit[eé]s?|quoi\s*de\s*neuf|latest\s*news?|recent\s*info|search\s*web|cherche\s*(?:sur\s*)?(?:le\s*)?web|google|trouve\s*(?:moi\s*)?(?:des\s*)?infos?|informations?\s*r[eé]centes?|ce\s*qui\s*se\s*passe|il\s*se\s*passe\s*quoi|quoi\s*à\s+(?:dubai|duba[iï]|paris|new\s*york|london|shanghai|singapore)|what['']?s\s*happening|current\s*events?|aujourd['']?hui\s*dans|situation\s*actuelle|(?:c['']?est\s+)?quoi\s+la\s+situation|la\s+situation|situation\s+[aà]|what['']?s\s+(?:the\s+)?situation|(?:dubai|duba[iï]|paris|new\s*york|london).*situation|situation.*(?:dubai|duba[iï]|paris|new\s*york|london)/i;
const FLIGHT_KEYWORDS = /(?:donne[rz]?|donnes?)\s*(?:moi\s*)?(?:les\s*)?(?:prochains?\s*)?vols?|prochains?\s*vols?|vols?\s+(?:de\s+|à\s+|entre\s+)?|flights?\s+(?:from\s+|to\s+|between\s+)?|give\s*me\s*(?:the\s*)?(?:next\s*)?flights?|prix\s*(?:des?\s*)?vols?|flight\s*prices?/i;
const CITY_PAIR = /\b(?:dubai|duba[iï]|paris|new\s*york|london|shanghai|singapore)\b.*\b(?:dubai|duba[iï]|paris|new\s*york|london|shanghai|singapore)\b/i;

function needsWebSearch(message) {
  if (!message || typeof message !== 'string') return false;
  const t = message.trim();
  return NEWS_KEYWORDS.test(t) || FLIGHT_KEYWORDS.test(t) || (/\b(?:vols?|flights?)\b/i.test(t) && CITY_PAIR.test(t)) || (/\bsituation\b/i.test(t) && /\b(?:dubai|duba[iï]|paris|new\s*york|london|shanghai|singapore)\b/i.test(t));
}

function isNewsQuery(message) {
  if (!message || typeof message !== 'string') return false;
  return NEWS_KEYWORDS.test(message.trim());
}

/**
 * Extract search query from user message (simplified: use message or a cleaned version).
 */
function extractQuery(message) {
  const t = (message || '').trim();
  if (!t) return '';
  const cleaned = t
    .replace(/^(dis?-?moi|tell\s*me|cherche|search|find|donne[rz]?\s*moi|donnes?\s*moi|give\s*me)\s+/i, '')
    .replace(/\s+(s['']?il\s*te\s*pla[iî]t|please|stp)\s*$/i, '')
    .trim();
  return cleaned || t;
}

module.exports = {
  search,
  formatForContext,
  needsWebSearch,
  extractQuery,
  isNewsQuery,
  isAvailable: () => !!(process.env.TAVILY_API_KEY || '').trim(),
};
