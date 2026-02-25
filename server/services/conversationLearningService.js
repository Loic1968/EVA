/**
 * EVA learns from conversations — extract facts/preferences/corrections
 * and store in memory_items. Runs async after each chat turn.
 */
const memoryItems = require('./memoryItemsService');

const EXTRACT_PROMPT = `You are analyzing a conversation between a user and EVA (AI assistant).

TASK: Extract ONLY items the USER explicitly stated as facts, preferences, or corrections.
- preference: "je préfère X", "j'aime X", "I prefer X"
- correction: "c'est faux", "non c'est Y", "corrige", "actually it's Y"
- fact: dates, names, plans the user shared ("mon vol est le 2 mars", "Pierre est mon contact")

RULES:
- Do NOT extract questions ("quelle date?", "what is?")
- Do NOT extract things EVA said
- Do NOT extract generic chitchat
- Be conservative: only extract when the user clearly stated something to remember
- Output JSON array: [{"kind":"preference|correction|fact","key":"short_slug","value":"exact phrase or value"}]
- Max 3 items. Key: lowercase, underscores, no spaces (e.g. vol_date, cafe_preference)`;

async function extractAndStoreLearnings(ownerId, messages) {
  if (!ownerId || !Array.isArray(messages) || messages.length < 2) return;
  const recent = messages.slice(-6).map((m) => `${m.role}: ${(m.content || '').slice(0, 500)}`).join('\n');
  if (recent.length < 50) return;

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!key) return;

    const client = new Anthropic({ apiKey: key.trim() });
    const r = await client.messages.create({
      model: process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: `${EXTRACT_PROMPT}\n\nConversation:\n${recent}` }],
    });
    const text = r.content?.find((b) => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return;

    let items;
    try {
      items = JSON.parse(jsonMatch[0]);
    } catch (_) {
      return;
    }
    if (!Array.isArray(items) || items.length === 0) return;

    for (const it of items.slice(0, 3)) {
      const kind = ['preference', 'correction', 'fact'].includes(it.kind) ? it.kind : 'fact';
      const keyStr = (it.key || memoryItems.slugify(it.value || '')).slice(0, 64);
      const value = (it.value || '').trim().slice(0, 500);
      if (keyStr && value) {
        await memoryItems.addMemoryItem(ownerId, kind, keyStr, value);
      }
    }
  } catch (e) {
    // Fire-and-forget: log but don't throw
    if (process.env.EVA_DEBUG === 'true') {
      console.warn('[ConversationLearning] Extract failed:', e.message);
    }
  }
}

/**
 * Call after saving chat messages. Pass the conversation history including the new turn.
 * Disable with EVA_CONVERSATION_LEARNING=false
 */
function learnFromConversation(ownerId, chatHistory) {
  if (process.env.EVA_CONVERSATION_LEARNING === 'false') return;
  if (!ownerId || !chatHistory?.length) return;
  setImmediate(() => {
    extractAndStoreLearnings(ownerId, chatHistory).catch(() => {});
  });
}

module.exports = { learnFromConversation, extractAndStoreLearnings };
