/**
 * Pre-answer shortcut — when EVA_OVERHAUL_ENABLED=true, answer directly from facts/memory
 * without calling the LLM. Guarantees consistency for DOB, flight dates, etc.
 * Read-only. No PII in logs.
 */
const factsService = require('./factsService');
const memoryItems = require('./memoryItemsService');

/** Question patterns → fact keys to try (in order). Keys are snake_case. */
const QUESTION_TO_KEYS = [
  { pattern: /date\s*de\s*naissance|ma\s*date\s*de\s*naissance|birth\s*date|dob|date\s*of\s*birth/i, keys: ['date_of_birth'] },
  { pattern: /lieu\s*de\s*naissance|place\s*of\s*birth|où\s*je\s*suis\s*né|where\s*(?:i\s*was\s*)?born/i, keys: ['place_of_birth', 'lieu_de_naissance'] },
  { pattern: /vol|flight|billet|departure|départ|décollage|prochain\s*vol/i, keys: ['flight_departure_date', 'flight_arrival_date', 'vol_date', 'next_flight'] },
  { pattern: /passport|passeport|numéro\s*de\s*passeport|document\s*number/i, keys: ['passport_number', 'document_number'] },
];

/**
 * Try to answer directly from eva.facts or eva.memory_items.
 * @param {number} ownerId
 * @param {string} userMessage - trimmed user message
 * @returns {Promise<{reply:string, source:string, confidence:number}|null>}
 */
async function tryPreAnswer(ownerId, userMessage) {
  if (!ownerId || typeof userMessage !== 'string') return null;
  const msg = userMessage.trim();
  if (!msg || msg.length < 3) return null;

  for (const { pattern, keys } of QUESTION_TO_KEYS) {
    if (!pattern.test(msg)) continue;
    for (const key of keys) {
      // 1. eva.facts (when EVA_STRUCTURED_MEMORY)
      if (process.env.EVA_STRUCTURED_MEMORY === 'true') {
        try {
          const fact = await factsService.getFactByKey(ownerId, key);
          if (fact && fact.value) {
            const conf = fact.confidence != null ? Number(fact.confidence) : 0.9;
            const src = fact.source_type || 'fact';
            return {
              reply: `${fact.value} (${src}, confiance ${(conf * 100).toFixed(0)}%)`,
              source: src,
              confidence: conf,
            };
          }
        } catch (_) {}
      }
      // 2. eva.memory_items (always, as fallback)
      try {
        const item = await memoryItems.getByKey(ownerId, key);
        if (item && item.value) {
          const src = item.kind === 'correction' ? 'correction' : item.kind || 'memory';
          return {
            reply: `${item.value} (${src}, confiance 90%)`,
            source: src,
            confidence: 0.9,
          };
        }
      } catch (_) {}
    }
  }
  return null;
}

module.exports = { tryPreAnswer, QUESTION_TO_KEYS };
