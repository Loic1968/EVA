/**
 * Ollama local — private / sensitive tasks (Eva 2 local brain)
 */
const BASE = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:14b';

function isConfigured() {
  return process.env.EVA_OLLAMA_ENABLED !== 'false';
}

async function complete({ systemPrompt, messages }) {
  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: ollamaMessages,
      stream: false,
    }),
    signal: AbortSignal.timeout(Number(process.env.EVA_OLLAMA_TIMEOUT_MS) || 120000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.message?.content || '';
  return {
    text,
    model: `ollama/${MODEL}`,
    tokens: {
      input: data.prompt_eval_count || 0,
      output: data.eval_count || 0,
    },
  };
}

module.exports = { isConfigured, complete };
