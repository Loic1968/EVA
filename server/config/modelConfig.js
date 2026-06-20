/**
 * Central Claude model resolution for EVA.
 *
 * Anthropic retires old model IDs; once retired, the API returns 404 and every
 * LLM call (chat, document parsing, auto-learn…) fails with a 500. To make EVA
 * resilient to this, every Anthropic call resolves its model through here:
 *  - an empty/missing value falls back to DEFAULT_CHAT_MODEL,
 *  - a known-retired ID is transparently remapped to its current replacement —
 *    so a stale EVA_CHAT_MODEL env var pointing at a dead model still works.
 */

const DEFAULT_CHAT_MODEL = 'claude-sonnet-4-6';

// Retired model id -> current replacement.
const RETIRED_MODELS = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-20240620': 'claude-sonnet-4-6',
};

/**
 * @param {string} [configured] model id from env or a hardcoded default
 * @returns {string} a current, callable Claude model id
 */
function resolveClaudeModel(configured) {
  const id = (configured || '').trim();
  if (!id) return DEFAULT_CHAT_MODEL;
  return RETIRED_MODELS[id] || id;
}

module.exports = { resolveClaudeModel, DEFAULT_CHAT_MODEL, RETIRED_MODELS };
