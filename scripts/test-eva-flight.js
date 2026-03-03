#!/usr/bin/env node
/**
 * Test EVA with flight question.
 * Run: cd eva && EVA_SKIP_AUTH=true node scripts/test-eva-flight.js
 * Requires: DATABASE_URL, ANTHROPIC_API_KEY or OPENAI_API_KEY in .env
 */
require('dotenv').config();
const path = require('path');
const baseEnv = path.resolve(__dirname, '../../.env');
const evaEnv = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: baseEnv });
require('dotenv').config({ path: evaEnv, override: true });

const BASE = process.env.EVA_TEST_URL || 'http://localhost:5002';

async function test() {
  console.log('=== EVA Flight Question Test ===\n');
  console.log('URL:', BASE);

  // 1. Health check
  try {
    const h = await fetch(`${BASE}/health`);
    const health = await h.json();
    console.log('Health:', health.status, '| anthropic:', health.anthropic, '| tavily:', health.tavily);
    if (health.status !== 'ok') {
      console.error('Server not ready');
      process.exit(1);
    }
  } catch (e) {
    console.error('Cannot reach EVA server. Start it with: cd eva && EVA_SKIP_AUTH=true npm run server');
    console.error(e.message);
    process.exit(1);
  }

  // 2. POST /api/chat (Claude path, full context)
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
    console.log('\n--- Testing POST /api/chat (Claude) ---');
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'à quelle heure est mon vol pour Shanghai ?',
          history: [],
        }),
      });
      const data = await res.json();
      console.log('Status:', res.status);
      console.log('Reply:', (data.reply || data.error || '').slice(0, 300) + (data.reply?.length > 300 ? '...' : ''));
      if (data.reply && /je ne peux pas accéder|consulter votre email|application de voyage|site de la compagnie/i.test(data.reply)) {
        console.error('FAIL: EVA gave generic chatbot response');
      } else if (data.reply) {
        console.log('OK: Response uses context (or says no data)');
      }
    } catch (e) {
      console.error('Chat failed:', e.message);
    }
  }

  // 3. POST /api/eva/chat (OpenAI path, messages format)
  if (process.env.OPENAI_API_KEY) {
    console.log('\n--- Testing POST /api/eva/chat (OpenAI) ---');
    try {
      const res = await fetch(`${BASE}/api/eva/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'à quelle heure est mon vol pour Shanghai ?' },
          ],
        }),
      });
      if (!res.ok) {
        console.error('Status:', res.status, await res.text());
        return;
      }
      const text = await res.text();
      const lines = text.split('\n').filter((l) => l.startsWith('data: '));
      let fullReply = '';
      for (const line of lines) {
        try {
          const payload = JSON.parse(line.slice(6));
          if (payload.delta) fullReply += payload.delta;
        } catch (_) {}
      }
      console.log('Reply:', fullReply.slice(0, 300) + (fullReply.length > 300 ? '...' : ''));
      if (fullReply && /je ne peux pas accéder|consulter votre email|application de voyage|site de la compagnie/i.test(fullReply)) {
        console.error('FAIL: EVA gave generic chatbot response');
      } else if (fullReply) {
        console.log('OK: Response uses context (or says no data)');
      }
    } catch (e) {
      console.error('EVA chat failed:', e.message);
    }
  }

  // 4. eva diag personal-tools (requires /api/chat with command)
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) {
    console.log('\n--- Testing eva diag personal-tools ---');
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'eva diag personal-tools',
          history: [],
        }),
      });
      const data = await res.json();
      console.log('Diagnostic:', data.reply || data.error);
    } catch (e) {
      console.error('Diag failed:', e.message);
    }
  }

  console.log('\n=== Test complete ===');
}

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
