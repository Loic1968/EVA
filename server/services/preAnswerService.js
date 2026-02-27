/**
 * Pre-answer from DB — when question matches stored fact or object, respond directly.
 * Used when EVA_ASSISTANT_MODE=true or EVA_OVERHAUL_ENABLED=true.
 * Avoids LLM call for known facts.
 */
const factsService = require('./factsService');
const objectsService = require('./objectsService');

const STATUS_QUERY_PATTERNS = [
  { pattern: /(?:o[uù]|where|statut|status|en\s+est).*(?:mon\s+)?(?:assurance|insurance)/i, key: 'insurance' },
  { pattern: /(?:o[uù]|where).*(?:on|en)\s*(?:est|we)\s*(?:mon|ma|my)\s*(?:vol|flight|voyage|travel)/i, key: 'travel' },
  { pattern: /(?:o[uù]|where).*(?:on|en)\s*(?:est|we)\s*(?:ma|my)\s*(?:visa)/i, key: 'visa' },
  { pattern: /(?:date|when).*(?:naissance|birth|born)/i, key: 'date_of_birth' },
  { pattern: /(?:ma|my)\s*(?:date\s+de\s+naissance|date\s+of\s+birth|dob)/i, key: 'date_of_birth' },
  { pattern: /(?:lieu|place).*(?:naissance|birth)/i, key: 'place_of_birth' },
  { pattern: /(?:vol|flight).*(?:shanghai|pvg|dubai|dxb)/i, key: 'departure_date' },
  { pattern: /(?:quand|when).*(?:part|depart|leave)/i, key: 'departure_date' },
];

async function tryPreAnswer(ownerId, userMessage) {
  if (!ownerId || !userMessage || typeof userMessage !== 'string') return null;

  const msg = userMessage.trim();
  if (msg.length < 3) return null;

  // 1. Check facts first (date_of_birth, etc.)
  for (const { pattern, key } of STATUS_QUERY_PATTERNS) {
    if (pattern.test(msg)) {
      const fact = await factsService.getFactByKey(ownerId, key);
      if (fact && fact.value) {
        return {
          reply: fact.value,
          source: 'fact',
          key: fact.key,
        };
      }
      // 2. Check objects for status questions (insurance, travel, visa)
      if (['insurance', 'travel', 'visa'].includes(key)) {
        const obj = await objectsService.getByType(ownerId, key);
        if (obj && (obj.status || obj.metadata?.status)) {
          const status = obj.status || obj.metadata?.status;
          const next = obj.metadata?.next_action || '—';
          return {
            reply: `Status: ${status}. Next action: ${next}.`,
            source: 'object',
            key,
          };
        }
      }
    }
  }

  return null;
}

module.exports = { tryPreAnswer };
