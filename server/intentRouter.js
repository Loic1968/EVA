/**
 * Intent Router — routes user questions BEFORE LLM/context.
 * Prevents irrelevant responses (Stripe, previous topics) for identity/fact queries.
 */
const FACTS_SERVICE = require('./services/factsService');

const INTENTS = Object.freeze({
  IDENTITY_QUERY: 'IDENTITY_QUERY',
  FACT_QUERY: 'FACT_QUERY',
  STATUS_QUERY: 'STATUS_QUERY',
  ACTION_QUERY: 'ACTION_QUERY',
  GENERAL_CHAT: 'GENERAL_CHAT',
});

/** Identity patterns → fact key to return. Order matters: first match wins. */
const IDENTITY_PATTERNS = [
  // full_name
  { pattern: /comment\s+(?:je\s+)?m['']appelle|qui\s+suis[- ]?je|what(?:'s|\s+is)\s+my\s+name|how\s+do\s+you\s+call\s+me|mon\s+nom\s+est|my\s+name\s+is/i, key: 'full_name' },
  { pattern: /who\s+am\s+i(?!\s+(?:supposed|going|the))/i, key: 'full_name' },
  { pattern: /quel\s+est\s+mon\s+nom|what\s+is\s+my\s+name/i, key: 'full_name' },
  // date_of_birth
  { pattern: /ma\s+date\s+de\s+naissance|my\s+date\s+of\s+birth|my\s+dob|date\s+of\s+birth|date\s+de\s+naissance/i, key: 'date_of_birth' },
  { pattern: /quand\s+(?:suis[- ]?je\s+)?n[eé]|when\s+(?:was\s+i\s+)?born/i, key: 'date_of_birth' },
  // passport_number
  { pattern: /mon\s+passeport|my\s+passport|passport\s+number|num[eé]ro\s+de\s+passeport/i, key: 'passport_number' },
  // phone
  { pattern: /mon\s+(?:t[eé]l[eé]phone|num[eé]ro)|my\s+phone|phone\s+number|t[eé]l[eé]phone/i, key: 'phone' },
  // email
  { pattern: /mon\s+(?:email|courriel)|my\s+email|email\s+address|adresse\s+(?:email|courriel)/i, key: 'email' },
];

/** Fact query: questions about stored facts (preAnswer handles these). */
const FACT_PATTERNS = [
  /what\s+(?:did\s+i\s+)?(?:tell\s+you|say)\s+about|ce\s+que\s+j['']ai\s+(?:dit|enregistr[eé])/i,
  /(?:do\s+you\s+)?remember\s+(?:that\s+)?(?:i\s+)?/i,
  /(?:ma\s+|my\s+)?(?:pr[eé]f[eé]rence|preference)s?\s+(?:sur|about|for)/i,
];

/** Status query: "where are we", "status", "update", "on my" */
const STATUS_PATTERNS = [
  /(?:o[uù]|where)\s+(?:en\s+)?(?:est[- ]?on|are\s+we|on\s+en\s+est)/i,
  /(?:quel\s+est\s+le\s+)?statut|status|update|mise\s+[aà]\s+jour/i,
  /(?:sur|on)\s+mon\s+/i,
];

/** Action query: "what should i do", "next step" */
const ACTION_PATTERNS = [
  /what\s+should\s+i\s+do|quoi\s+faire|next\s+step|prochaine\s+[eé]tape/i,
  /que\s+dois[- ]?je\s+faire/i,
];

function detectIntent(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return INTENTS.GENERAL_CHAT;
  const msg = userMessage.trim().toLowerCase();
  if (msg.length < 2) return INTENTS.GENERAL_CHAT;

  // 1. Identity first
  for (const { pattern } of IDENTITY_PATTERNS) {
    if (pattern.test(userMessage.trim())) return INTENTS.IDENTITY_QUERY;
  }

  // 2. Status
  if (STATUS_PATTERNS.some((re) => re.test(userMessage))) return INTENTS.STATUS_QUERY;

  // 3. Action
  if (ACTION_PATTERNS.some((re) => re.test(userMessage))) return INTENTS.ACTION_QUERY;

  // 4. Fact (questions about stored facts)
  if (FACT_PATTERNS.some((re) => re.test(userMessage))) return INTENTS.FACT_QUERY;

  return INTENTS.GENERAL_CHAT;
}

/** For IDENTITY_QUERY: resolve which fact key the user is asking about. */
function getIdentityFactKey(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return null;
  const msg = userMessage.trim();
  for (const { pattern, key } of IDENTITY_PATTERNS) {
    if (pattern.test(msg)) return key;
  }
  return null;
}

const IDENTITY_FALLBACK = "I do not currently have this information stored.";

/**
 * Resolve identity query from eva.facts. NO LLM. No emails, documents, or conversation context.
 * @param {number} ownerId
 * @param {string} userMessage
 * @returns {Promise<string>} reply or IDENTITY_FALLBACK
 */
async function resolveIdentityQuery(ownerId, userMessage) {
  const key = getIdentityFactKey(userMessage);
  if (!key) return IDENTITY_FALLBACK;

  try {
    const fact = await FACTS_SERVICE.getFactByKey(ownerId, key);
    if (fact && fact.value && String(fact.value).trim()) {
      return String(fact.value).trim();
    }
  } catch (e) {
    console.warn('[EVA intentRouter] resolveIdentityQuery failed:', e.message);
  }
  return IDENTITY_FALLBACK;
}

module.exports = {
  detectIntent,
  getIdentityFactKey,
  resolveIdentityQuery,
  INTENTS,
  IDENTITY_FALLBACK,
};
