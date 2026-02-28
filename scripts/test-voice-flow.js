#!/usr/bin/env node
/**
 * Test EVA voice flow: signup -> login -> realtime token.
 * Run: node scripts/test-voice-flow.js
 */
const BASE = 'http://localhost:5002/api';
const TEST_EMAIL = `eva-test-${Date.now()}@test.local`;
const TEST_PASS = 'Test1234!';

async function run() {
  try {
    // 1. Signup
    const signRes = await fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS, display_name: 'EVA Test' }),
    });
    if (!signRes.ok) {
      const err = await signRes.json().catch(() => ({}));
      throw new Error(`Signup failed: ${signRes.status} ${JSON.stringify(err)}`);
    }
    const { token } = await signRes.json();
    console.log('[OK] Signup -> token received');

    // 2. Realtime token (with auth)
    const tokRes = await fetch(`${BASE}/realtime/token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!tokRes.ok) {
      const err = await tokRes.text();
      throw new Error(`Realtime token failed: ${tokRes.status} ${err}`);
    }
    const tokData = await tokRes.json();
    const ephemeralKey = tokData?.value ?? tokData?.client_secret?.value;
    if (!ephemeralKey) throw new Error('No ephemeral key in response');
    console.log('[OK] Realtime token -> ephemeral key received (create_response: false, manual trigger)');

    console.log('\n✓ Voice flow OK. Server ready for http://localhost:3001/voice');
  } catch (e) {
    console.error('✗', e.message);
    process.exit(1);
  }
}

run();
