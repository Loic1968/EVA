/**
 * Intent Router — routes user input BEFORE LLM/context.
 * Prevents malentendus and hallucinations: ambiguous/short → "Oui ?", validation → "Parfait."
 */
const FACTS_SERVICE = require('./services/factsService');

const INTENTS = Object.freeze({
  CHECK_IN: 'CHECK_IN',
  VALIDATION: 'VALIDATION',
  AMBIGUOUS: 'AMBIGUOUS',
  IDENTITY_QUERY: 'IDENTITY_QUERY',
  FACT_QUERY: 'FACT_QUERY',
  STATUS_QUERY: 'STATUS_QUERY',
  ACTION_QUERY: 'ACTION_QUERY',
  LOCATION_QUERY: 'LOCATION_QUERY',
  GENERAL_CHAT: 'GENERAL_CHAT',
});

/** Check-in: user asks if EVA hears them → "Oui" only, no LLM */
const CHECK_IN_PATTERNS = [
  /tu\s+m['']entends\s*\??/i,
  /tu\s+m[''][eé]coutes\s*\??/i,
  /are\s+you\s+there\s*\??/i,
  /do\s+you\s+hear\s+me\s*\??/i,
  /tu\s+me\s+entends/i,
  /tu\s+me\s+[eé]coutes/i,
];

/** Validation: user validates/satisfied → "Parfait." only, no LLM, no inventing changes */
const VALIDATION_PATTERNS = [
  /^(parfait|c'est bon|nickel|propre|c'est propre|ok c'est bon|validé|top|super|génial|bien)$/i,
  /^(perfect|great|fine|good|validated|approved)$/i,
];

/** Ambiguous: too short, noise, or unclear → "Oui ?" — never send to LLM (hallucination risk) */
const AMBIGUOUS_PATTERNS = [
  /^\.+$/,           // "..."
  /^[,;:!?]+$/,      // punctuation only
  /^(ok|oui|non|ah|euh|hum|quoi|voilà|voila|bonjour|salut|hello|hi|yo|merci|hein)$/i,
  /^(ciel|système|que peut-être|c'est chaud)$/i,
  /^[a-zéèêëàâäùûüïîô]{1,15}$/i,  // single short word
];

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

/** Location: GPS / where am I / what time (uses live location, not LLM guess). */
const LOCATION_PATTERNS = [
  /où\s+(?:suis|je\s+suis)/i,
  /where\s+am\s+i/i,
  /(?:quelle|what)\s+(?:heure|time)\s+(?:est[- ]?il|is\s+it)/i,
  /(?:ma|my)\s+(?:position|localisation|location)/i,
  /(?:géo|geo)loc/i,
  /j['']habite\s+où/i,
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
  if (!userMessage || typeof userMessage !== 'string') return INTENTS.AMBIGUOUS;
  const t = userMessage.trim();
  const msg = t.toLowerCase();
  if (msg.length < 2) return INTENTS.AMBIGUOUS;

  // 1. Check-in (Tu m'entends ? → Oui)
  if (CHECK_IN_PATTERNS.some((re) => re.test(t))) return INTENTS.CHECK_IN;

  // 2. Validation (Parfait, c'est bon → Parfait.)
  if (VALIDATION_PATTERNS.some((re) => re.test(t))) return INTENTS.VALIDATION;

  // 3. Ambiguous (ok, bonjour seul, euh, etc. → Oui ?) — never LLM
  if (msg.length <= 20 && AMBIGUOUS_PATTERNS.some((re) => re.test(t))) return INTENTS.AMBIGUOUS;

  // 4. Location (GPS — before identity/LLM)
  if (LOCATION_PATTERNS.some((re) => re.test(t))) return INTENTS.LOCATION_QUERY;

  // 5. Identity
  for (const { pattern } of IDENTITY_PATTERNS) {
    if (pattern.test(t)) return INTENTS.IDENTITY_QUERY;
  }

  // 6. Status
  if (STATUS_PATTERNS.some((re) => re.test(t))) return INTENTS.STATUS_QUERY;

  // 7. Action
  if (ACTION_PATTERNS.some((re) => re.test(t))) return INTENTS.ACTION_QUERY;

  // 8. Fact
  if (FACT_PATTERNS.some((re) => re.test(t))) return INTENTS.FACT_QUERY;

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

const CHECK_IN_REPLY = "Oui, je t'entends.";
const VALIDATION_REPLY = "Parfait.";
const AMBIGUOUS_REPLY = "Oui ?";

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

async function resolveLocationQuery(ownerId, liveLocation = null) {
  const locationService = require('./services/locationService');
  let loc = liveLocation;
  if (!loc && ownerId) {
    try {
      loc = await locationService.getLocation(ownerId);
    } catch (e) {
      console.warn('[EVA intentRouter] resolveLocationQuery failed:', e.message);
    }
  }
  const base = locationService.formatLocationReply(loc);
  if (!loc?.timezone) return base;
  const time = new Date().toLocaleString('fr-FR', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: loc.timezone,
  });
  return `${base} · Il est ${time}.`;
}

module.exports = {
  detectIntent,
  getIdentityFactKey,
  resolveIdentityQuery,
  resolveLocationQuery,
  INTENTS,
  IDENTITY_FALLBACK,
  CHECK_IN_REPLY,
  VALIDATION_REPLY,
  AMBIGUOUS_REPLY,
};
