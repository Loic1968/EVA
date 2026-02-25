#!/usr/bin/env node
/**
 * EVA Production Test – tests all key API endpoints on eva.halisoft.biz
 * Usage: EVA_API_BASE=https://eva.halisoft.biz EVA_TEST_EMAIL=x@y.com EVA_TEST_PASSWORD=xxx node scripts/prod-test.js
 * Without creds: tests public endpoints only.
 */
const BASE = process.env.EVA_API_BASE || 'https://eva.halisoft.biz';
const TEST_EMAIL = process.env.EVA_TEST_EMAIL;
const TEST_PASSWORD = process.env.EVA_TEST_PASSWORD;

let token = null;

async function fetch(method, path, body, headers = {}) {
  const url = new URL(path, BASE);
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...headers },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  const lib = url.protocol === 'https:' ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = lib.request(url, opts, (r) => {
      let data = '';
      r.on('data', (c) => (data += c));
      r.on('end', () => {
        try {
          resolve({ status: r.statusCode, data: data ? JSON.parse(data) : null, raw: data });
        } catch (_) {
          resolve({ status: r.statusCode, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function login() {
  if (!TEST_EMAIL || !TEST_PASSWORD) return false;
  const r = await fetch('POST', '/api/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD });
  if (r.status === 200 && r.data?.token) {
    token = r.data.token;
    return true;
  }
  return false;
}

function ok(name, r, expectStatus = 200) {
  const pass = r.status === expectStatus;
  console.log(pass ? `  ✓ ${name}` : `  ✗ ${name} (${r.status} ${r.data?.error || r.raw?.slice(0, 80) || ''})`);
  return pass;
}

async function run() {
  console.log('EVA Production Test @', BASE);
  console.log('');

  let passed = 0;
  let failed = 0;

  // ─── Public endpoints ─────────────────────────────────────────────────
  let r = await fetch('GET', '/health');
  if (ok('GET /health', r)) passed++; else failed++;

  r = await fetch('GET', '/api/auth/config');
  if (ok('GET /api/auth/config', r)) passed++; else failed++;

  // ─── Auth (optional) ─────────────────────────────────────────────────
  if (TEST_EMAIL && TEST_PASSWORD) {
    if (await login()) {
      console.log('  ✓ Login OK');
      passed++;
    } else {
      console.log('  ✗ Login failed (check EVA_TEST_EMAIL / EVA_TEST_PASSWORD)');
      failed++;
    }
  } else {
    console.log('  ⏭ Skip auth endpoints (set EVA_TEST_EMAIL + EVA_TEST_PASSWORD for full test)');
  }

  // ─── Auth-required endpoints (only if we have token) ───────────────────
  if (token) {
    r = await fetch('GET', '/api/status');
    if (ok('GET /api/status', r)) passed++; else failed++;

    r = await fetch('GET', '/api/settings');
    if (ok('GET /api/settings', r)) passed++; else failed++;

    r = await fetch('GET', '/api/drafts');
    if (ok('GET /api/drafts', r)) passed++; else failed++;

    r = await fetch('GET', '/api/documents?limit=5');
    if (ok('GET /api/documents', r)) passed++; else failed++;

    r = await fetch('GET', '/api/conversations?limit=5');
    if (ok('GET /api/conversations', r)) passed++; else failed++;

    r = await fetch('GET', '/api/data-sources');
    if (ok('GET /api/data-sources', r)) passed++; else failed++;

    r = await fetch('GET', '/api/audit-logs?limit=5');
    if (ok('GET /api/audit-logs', r)) passed++; else failed++;

    r = await fetch('GET', '/api/confidence-summary');
    if (ok('GET /api/confidence-summary', r)) passed++; else failed++;

    r = await fetch('GET', '/api/stats');
    if (ok('GET /api/stats', r)) passed++; else failed++;

    r = await fetch('GET', '/api/realtime/token');
    if (ok('GET /api/realtime/token', r)) passed++; else failed++;
  }

  console.log('');
  console.log('Result:', passed, 'passed,', failed, 'failed');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
