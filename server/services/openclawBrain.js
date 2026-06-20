/**
 * OpenClaw Gateway — OpenAI-compatible /v1/chat/completions (Eva 2 hybrid brain)
 */
function gatewayUrl() {
  const base = (process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789').replace(/\/$/, '');
  return `${base}/v1/chat/completions`;
}

function getToken() {
  const t = (process.env.OPENCLAW_GATEWAY_TOKEN || '').trim();
  return t && t.length > 8 ? t : null;
}

function isConfigured() {
  return process.env.EVA_USE_OPENCLAW_BRAIN !== 'false' && !!getToken();
}

async function complete({ systemPrompt, messages, sessionUser }) {
  const token = getToken();
  if (!token) throw new Error('OPENCLAW_GATEWAY_TOKEN not set');

  const oaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const res = await fetch(gatewayUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: process.env.EVA_OPENCLAW_MODEL || 'openclaw/default',
      user: sessionUser || 'eva-web:default',
      messages: oaiMessages,
      max_tokens: 4096,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(Number(process.env.EVA_OPENCLAW_TIMEOUT_MS) || 90000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenClaw ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return {
    text,
    model: data.model || 'openclaw/default',
    tokens: {
      input: data.usage?.prompt_tokens || 0,
      output: data.usage?.completion_tokens || 0,
    },
  };
}

module.exports = { isConfigured, complete };
