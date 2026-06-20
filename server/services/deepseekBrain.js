/**
 * DeepSeek API — OpenAI-compatible chat (Eva 2 primary brain)
 */
const OpenAI = require('openai');

function getKey() {
  const k = (process.env.DEEPSEEK_API_KEY || '').trim();
  return k && !k.startsWith('sk-...') ? k : null;
}

function isConfigured() {
  return !!getKey();
}

function getClient() {
  const apiKey = getKey();
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');
  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  });
}

async function complete({ systemPrompt, messages }) {
  const client = getClient();
  const model = process.env.EVA_DEEPSEEK_MODEL || 'deepseek-chat';
  const oaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const res = await client.chat.completions.create({
    model,
    messages: oaiMessages,
    max_tokens: 4096,
    temperature: 0.3,
  });
  const text = res.choices?.[0]?.message?.content || '';
  return {
    text,
    model: res.model || model,
    tokens: {
      input: res.usage?.prompt_tokens || 0,
      output: res.usage?.completion_tokens || 0,
    },
  };
}

module.exports = { isConfigured, complete };
