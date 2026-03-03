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
 * Includes: news, flights (vols Dubai NY), real-time info, city updates.
 */
const NEWS_KEYWORDS = /derni[eè]res?\s*infos?|actualit[eé]s?|quoi\s*de\s*neuf|latest\s*news?|recent\s*info|search\s*web|cherche\s*(?:sur\s*)?(?:le\s*)?web|recherche\s*(?:sur\s*)?(?:le\s*)?web|google|trouve\s*(?:moi\s*)?(?:des\s*)?infos?|informations?\s*r[eé]centes?|ce\s*qui\s*se\s*passe|il\s*se\s*passe\s*quoi|quoi\s*[aà]\s+(?:dubai|doubai|duba[iï]|paris|new\s*york|london|shanghai|singapore)|what['']?s\s*happening|current\s*events?|aujourd['']?hui\s*dans|situation\s*actuelle|(?:c['']?est\s+)?quoi\s+la\s+situation|la\s+situation|situation\s+[aà]|what['']?s\s+(?:the\s+)?situation|(?:dubai|doubai|duba[iï]|paris|new\s*york|london).*situation|situation.*(?:dubai|doubai|duba[iï]|paris|new\s*york|london)/i;
const FLIGHT_KEYWORDS = /(?:donne[rz]?|donnes?)\s*(?:moi\s*)?(?:les\s*)?(?:prochains?\s*)?vols?|prochains?\s*vols?|vols?\s+(?:de\s+|à\s+|pour\s+|entre\s+)?|flights?\s+(?:from\s+|to\s+|between\s+)?|give\s*me\s*(?:the\s*)?(?:next\s*)?flights?|prix\s*(?:des?\s*)?vols?|flight\s*prices?/i;
const CITY_PAIR = /\b(?:dubai|doubai|duba[iï]|paris|new\s*york|london|shanghai|singapore)\b.*\b(?:dubai|doubai|duba[iï]|paris|new\s*york|london|shanghai|singapore)\b/i;
const CITIES = /\b(?:dubai|doubai|duba[iï]|paris|new\s*york|london|shanghai|singapore|doha|abu\s*dhabi|mumbai|hong\s*kong)\b/i;
// "what up in dubai", "quoi de neuf a/à Dubai", "quoi de neuf à doubai" — "a" or "à", city with/without typo
const CITY_WHATSUP = /(?:what\s*['']?s?\s*up|whats?\s+up|what['']?s\s*going\s*on|what['']?s\s*new|quoi\s*de\s*neuf|what\s*is\s*happening).*(?:in|[aà]\s*)\s*(?:dubai|doubai|duba[iï]|paris|new\s*york|london|shanghai|singapore|doha|abu\s*dhabi|mumbai|hong\s*kong)|(?:dubai|doubai|duba[iï]|paris|new\s*york|london|shanghai|singapore|doha|abu\s*dhabi|mumbai|hong\s*kong).*(?:what\s*['']?s?\s*up|whats?\s+up|what['']?s\s*going\s*on|what['']?s\s*new|quoi\s*de\s*neuf)/i;
// Weather: météo, temps (il fait quel temps), température, forecast
const WEATHER_KEYWORDS = /\bm[eé]t[eé]o\b|weather|temps\s*(?:à|a|pour)|quel\s*temps|il\s*fait\s*(?:quel\s*)?temps|temp[eé]rature|forecast|pr[eé]visions?\s*m[eé]t[eé]o|climat\s*(?:à|a|pour)/i;
// Airport: statut aéroport, conditions, retards, DXB
const AIRPORT_KEYWORDS = /\ba[eé]roport\b|airport|dxb|statut\s*(?:de\s+l['']?)?(?:a[eé]roport)?|conditions?\s*(?:de\s+l['']?)?(?:a[eé]roport)?|retards?|delays?|perturbations?/i;

function needsWebSearch(message) {
  if (!message || typeof message !== 'string') return false;
  const t = message.trim();
  return NEWS_KEYWORDS.test(t) || FLIGHT_KEYWORDS.test(t) || CITY_WHATSUP.test(t) ||
    (/\b(?:vols?|flights?)\b/i.test(t) && CITY_PAIR.test(t)) ||
    (/\bsituation\b/i.test(t) && CITIES.test(t)) ||
    (WEATHER_KEYWORDS.test(t) && CITIES.test(t)) ||
    (AIRPORT_KEYWORDS.test(t) && CITIES.test(t)) ||
    /\b(?:wt|what)\s*(?:about|with|at)\s*(?:dubai|shanghai|paris|london)\s*(?:airport|a[eé]roport)?/i.test(t);
}

function isNewsQuery(message) {
  if (!message || typeof message !== 'string') return false;
  return NEWS_KEYWORDS.test(message.trim());
}

const CITY_EXTRACT = /\b(dubai|duba[iï]|paris|london|new\s*york|shanghai|singapore|doha|abu\s*dhabi|mumbai|hong\s*kong)\b/i;

/**
 * Extract search query from user message. For "what up in X" type → "X news today" for better results.
 */
function extractQuery(message) {
  const t = (message || '').trim();
  if (!t) return '';

  const cityMatch = t.match(CITY_EXTRACT);
  const city = cityMatch ? cityMatch[1].replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';

  // "what up in dubai", "quoi de neuf à Paris" → "Dubai news today"
  if (city && /what\s*up|whats?\s*up|quoi\s*de\s*neuf|what['']?s\s*(going\s*on|new)/i.test(t)) {
    return `${city} news today current events`;
  }
  // "il fait quel temps à Shanghai", "weather in Dubai" → "Shanghai weather"
  if (city && WEATHER_KEYWORDS.test(t)) {
    return `${city} weather forecast today`;
  }
  // "wt dubai airport", "statut aéroport Dubai" → "Dubai airport status"
  if (city && AIRPORT_KEYWORDS.test(t)) {
    return `${city} airport status today`;
  }

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
