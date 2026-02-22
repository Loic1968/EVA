/**
 * EVA AI – conversation with Claude (agent persona).
 * Same stack as Halisoft: Anthropic Claude. Later: RAG (Memory Vault) + fine-tuned model.
 */
const Anthropic = require('@anthropic-ai/sdk');

const EVA_SYSTEM = `You are EVA, a Personal AI Digital Twin. You act as a helpful, professional assistant that mirrors and supports your user (Loic). You work for HaliSoft L.L.C-FZ in Dubai (invoice factoring, trade finance). You are concise, direct, and slightly formal when needed. You can suggest next steps, summarize, draft replies, or answer questions. You do not pretend to have access to the user's emails or memory vault yet—if asked, say that full memory is being connected. Reply in the same language the user uses (French or English).`;

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY required for EVA chat');
  return new Anthropic({ apiKey: key.trim() });
}

/**
 * @param {string} userMessage
 * @param {Array<{role:'user'|'assistant',content:string}>} [history]
 * @returns {Promise<{reply:string}>}
 */
async function reply(userMessage, history = []) {
  const client = getClient();
  const model = process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514';

  const messages = [
    ...history.slice(-20).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: EVA_SYSTEM,
    messages,
  });

  const textBlock = response.content?.find((b) => b.type === 'text');
  const reply = textBlock ? textBlock.text : 'No response.';

  return { reply };
}

module.exports = { reply, getClient };
