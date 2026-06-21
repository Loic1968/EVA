/**
 * Central model registry for EVA — single source of truth for every model id.
 *
 * Why: model ids were hardcoded across many files, so an Anthropic model
 * retirement (404 -> 500 on every call) became a multi-file prod outage.
 * Keep ALL ids here; the next retirement is a one-line change.
 *
 * Tiering: CHAT/VISION use the strong reasoning model; FAST uses Haiku for cheap
 * classification/extraction (email triage, web-search routing, fact extraction)
 * — much cheaper/faster with no quality loss on those tasks.
 *
 * resolveClaudeModel() additionally remaps known-retired Claude ids to a live one,
 * so a stale env var pointing at a dead model still works.
 */

const MODELS = {
  // Anthropic (Claude)
  CHAT: 'claude-sonnet-4-6',              // main reasoning brain (chat)
  VISION: 'claude-sonnet-4-6',            // document OCR / image understanding
  FAST: 'claude-haiku-4-5-20251001',     // cheap classification / extraction
  // OpenAI
  GPT_CHAT: 'gpt-4o',                     // alternate chat brain (user toggle)
  GPT_MINI: 'gpt-4o-mini',               // light/cheap OpenAI tasks
  STT: 'gpt-4o-transcribe',              // speech-to-text
  STT_FALLBACK: 'whisper-1',             // legacy STT fallback
  TTS: 'tts-1',                          // text-to-speech
  TTS_HD: 'tts-1-hd',                    // text-to-speech (HD)
  REALTIME: 'gpt-realtime',              // realtime voice
};

const DEFAULT_CHAT_MODEL = MODELS.CHAT;

// Retired Claude model id -> current replacement.
const RETIRED_MODELS = {
  'claude-sonnet-4-20250514': MODELS.CHAT,
  'claude-3-5-sonnet-20241022': MODELS.CHAT,
  'claude-3-5-sonnet-20240620': MODELS.CHAT,
  'claude-3-haiku-20240307': MODELS.FAST,
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

module.exports = { MODELS, resolveClaudeModel, DEFAULT_CHAT_MODEL, RETIRED_MODELS };
