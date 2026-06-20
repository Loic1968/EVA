/**
 * EVA conversation learning — auto-extract durable facts from a conversation turn
 * and store them in eva.facts so EVA remembers across sessions WITHOUT the user
 * having to run /remember.
 *
 * Design:
 *  - Fire-and-forget: called un-awaited from the chat route; never blocks the reply.
 *  - Gated by EVA_STRUCTURED_MEMORY=true (the facts layer must be enabled), and can
 *    be disabled independently with EVA_AUTO_LEARN=false.
 *  - Extracts only STABLE, long-term facts about the user via a focused LLM call.
 *  - Stored at PRIORITY_CONVERSATION (5) via upsertFactSoftSafe, so an auto-learned
 *    fact can NEVER overwrite an explicit /remember (50) or /correct (100).
 *  - Never throws; all failures are swallowed with a warning.
 */

const MAX_FACTS_PER_TURN = 6;
const MAX_KEY_LEN = 80;
const MAX_VALUE_LEN = 200;

/** Coerce an Anthropic-style message content (string or content blocks) to plain text. */
function asText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : b && b.type === 'text' ? b.text : ''))
      .join(' ');
  }
  return '';
}

/** Pull the most recent user message + the assistant reply that followed it. */
function lastUserAssistantTurn(history) {
  let assistantIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] && history[i].role === 'assistant') { assistantIdx = i; break; }
  }
  if (assistantIdx < 1) return null;
  let userIdx = -1;
  for (let i = assistantIdx - 1; i >= 0; i--) {
    if (history[i] && history[i].role === 'user') { userIdx = i; break; }
  }
  if (userIdx < 0) return null;
  return {
    user: asText(history[userIdx].content).trim(),
    assistant: asText(history[assistantIdx].content).trim(),
  };
}

/** Skip turns that can't carry a durable fact (greetings, acks, slash-commands, too short). */
function isTrivialUserMessage(text) {
  const t = (text || '').trim();
  if (t.length < 12) return true;
  if (t.startsWith('/')) return true; // /remember, /correct, /forget handled elsewhere
  if (/^(hi|hello|hey|salut|bonjour|coucou|merci|thanks|thank you|ok|okay|yes|no|oui|non|yep|nope|cool|super|parfait)\b[\s!.…]*$/i.test(t)) return true;
  return false;
}

/** Robustly parse a JSON array of {key,value} from an LLM reply (tolerates code fences/prose). */
function parseExtractedFacts(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  let arr;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.key || '').trim().slice(0, MAX_KEY_LEN);
    const value = String(item.value || '').trim().slice(0, MAX_VALUE_LEN);
    if (!key || !value) continue;
    out.push({ key, value });
    if (out.length >= MAX_FACTS_PER_TURN) break;
  }
  return out;
}

const EXTRACTION_SYSTEM = [
  'You extract DURABLE, long-term facts about the USER worth remembering across future conversations.',
  'Output ONLY a JSON array of objects {"key","value"} — no prose, no markdown.',
  'Rules:',
  '- Include only STABLE facts the user stated about THEMSELVES or their work: role, company, home city, timezone, languages, recurring preferences, key relationships, ongoing projects, important dates.',
  '- key: short snake_case English identifier (e.g. "home_city", "preferred_language", "company_name").',
  '- value: concise factual statement (max ~120 chars).',
  '- EXCLUDE: questions, one-off or ephemeral details, anything about the assistant, anything speculative/uncertain, and the assistant\'s own answers.',
  '- If nothing durable is present, output exactly: []',
].join('\n');

/**
 * @param {number|string} ownerId
 * @param {Array<{role:string, content:any}>} historyWithNewTurn  full history incl. the new user+assistant turn
 */
async function learnFromConversation(ownerId, historyWithNewTurn) {
  if (!ownerId || !Array.isArray(historyWithNewTurn)) return;
  if (process.env.EVA_STRUCTURED_MEMORY !== 'true') return;
  if (process.env.EVA_AUTO_LEARN === 'false') return;

  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) return;

  try {
    const turn = lastUserAssistantTurn(historyWithNewTurn);
    if (!turn || !turn.user) return;
    if (isTrivialUserMessage(turn.user)) return;

    const Anthropic = require('@anthropic-ai/sdk');
    const { resolveClaudeModel } = require('../config/modelConfig');
    const client = new Anthropic({ apiKey: key.trim() });
    const model = resolveClaudeModel(process.env.EVA_FACTS_MODEL || process.env.EVA_CHAT_MODEL);

    const res = await client.messages.create({
      model,
      max_tokens: 400,
      system: EXTRACTION_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Exchange to analyze:\n\nUSER: ${turn.user.slice(0, 2000)}\n\nASSISTANT: ${turn.assistant.slice(0, 2000)}`,
        },
      ],
    });

    const raw = res.content?.find((b) => b.type === 'text')?.text || '';
    const facts = parseExtractedFacts(raw);
    if (facts.length === 0) return;

    const factsService = require('./factsService');
    let stored = 0;
    for (const f of facts) {
      const id = await factsService.upsertFactSoftSafe(
        ownerId, f.key, f.value, 'conversation', null, factsService.PRIORITY_CONVERSATION
      );
      if (id) stored++;
    }
    if (stored > 0) {
      console.log(`[EVA] auto-learned ${stored} fact(s) for owner ${ownerId}`);
    }
  } catch (e) {
    console.warn('[EVA] conversationLearning:', e.message);
  }
}

module.exports = { learnFromConversation };
// Exposed for unit tests (pure helpers, no I/O):
module.exports.__test = { asText, lastUserAssistantTurn, isTrivialUserMessage, parseExtractedFacts };
