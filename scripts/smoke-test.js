#!/usr/bin/env node
/**
 * EVA smoke test: health + API endpoints (backend must be running on 5002).
 * Usage: npm run test:smoke   (from eva/)
 */
const BASE = process.env.EVA_API_BASE || 'http://localhost:5002';

const http = require('http');
const https = require('https');

function get(path) {
  const url = new URL(path, BASE);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    lib
      .get(url, (r) => {
        let body = '';
        r.on('data', (c) => (body += c));
        r.on('end', () => {
          try {
            resolve({ status: r.statusCode, data: body ? JSON.parse(body) : null });
          } catch (_) {
            resolve({ status: r.statusCode, data: body });
          }
        });
      })
      .on('error', reject);
  });
}

function post(path, body) {
  const url = new URL(path, BASE);
  const lib = url.protocol === 'https:' ? https : http;
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (r) => {
      let body = '';
      r.on('data', (c) => (body += c));
      r.on('end', () => {
        try {
          resolve({ status: r.statusCode, data: body ? JSON.parse(body) : null });
        } catch (_) {
          resolve({ status: r.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('EVA smoke test @', BASE);
  let ok = 0;
  let fail = 0;

  try {
    const h = await get('/health');
    if (h.status === 200 && h.data?.app === 'eva') {
      console.log('  GET /health OK');
      ok++;
    } else {
      console.log('  GET /health FAIL', h.status, h.data);
      fail++;
    }
  } catch (e) {
    console.log('  GET /health ERROR', e.message);
    fail++;
  }

  try {
    const d = await get('/api/drafts');
    if (d.status === 200 && Array.isArray(d.data?.drafts)) {
      console.log('  GET /api/drafts OK');
      ok++;
    } else if (d.status === 401) {
      console.log('  GET /api/drafts OK (401, auth required)');
      ok++;
    } else {
      console.log('  GET /api/drafts FAIL', d.status);
      fail++;
    }
  } catch (e) {
    console.log('  GET /api/drafts ERROR', e.message);
    fail++;
  }

  try {
    const st = await get('/api/status');
    if (st.status === 200 && typeof st.data?.eva_enabled === 'boolean') {
      console.log('  GET /api/status OK (eva_enabled:', st.data.eva_enabled + ')');
      ok++;
    } else if (st.status === 401) {
      console.log('  GET /api/status OK (401, auth required)');
      ok++;
    } else {
      console.log('  GET /api/status FAIL', st.status);
      fail++;
    }
  } catch (e) {
    console.log('  GET /api/status ERROR', e.message);
    fail++;
  }

  try {
    const s = await get('/api/settings');
    if (s.status === 200 && typeof s.data === 'object') {
      console.log('  GET /api/settings OK');
      ok++;
    } else if (s.status === 401) {
      console.log('  GET /api/settings OK (401, auth required)');
      ok++;
    } else {
      console.log('  GET /api/settings FAIL', s.status);
      fail++;
    }
  } catch (e) {
    console.log('  GET /api/settings ERROR', e.message);
    fail++;
  }

  // STT endpoint: must respond (no EMPTY_RESPONSE). Short audio → 400, large payload → any JSON
  try {
    const stt = await post('/api/voice/stt', { audio: 'A'.repeat(100), format: 'webm', lang: 'fr' });
    if (stt.status === 400 && stt.data?.code === 'audio_too_short') {
      console.log('  POST /api/voice/stt OK (400 audio_too_short)');
      ok++;
    } else if (stt.status === 401) {
      console.log('  POST /api/voice/stt OK (401, auth required)');
      ok++;
    } else if (stt.status === 503) {
      console.log('  POST /api/voice/stt OK (503, voice disabled)');
      ok++;
    } else {
      console.log('  POST /api/voice/stt UNEXPECTED', stt.status, stt.data);
      fail++;
    }
  } catch (e) {
    console.log('  POST /api/voice/stt ERROR', e.message);
    fail++;
  }

  // STT with large payload (~130KB base64 like 8s recording): must NOT return EMPTY_RESPONSE
  try {
    const large = await post('/api/voice/stt', { audio: 'A'.repeat(175000), format: 'webm', lang: 'fr' });
    if (large.status >= 400 && large.data && typeof large.data === 'object') {
      console.log('  POST /api/voice/stt (large) OK (got JSON response, no empty)');
      ok++;
    } else if (large.status === 401) {
      console.log('  POST /api/voice/stt (large) OK (401)');
      ok++;
    } else {
      console.log('  POST /api/voice/stt (large) UNEXPECTED', large.status, typeof large.data);
      fail++;
    }
  } catch (e) {
    console.log('  POST /api/voice/stt (large) ERROR', e.message);
    fail++;
  }

  console.log('');
  if (fail) {
    console.log('Result:', ok, 'ok,', fail, 'failed');
    process.exit(1);
  }
  console.log('All', ok, 'checks passed.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
