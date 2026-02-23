#!/usr/bin/env node
/**
 * EVA smoke test: health + API endpoints (backend must be running on 5002).
 * Usage: npm run test:smoke   (from eva/)
 */
const BASE = process.env.EVA_API_BASE || 'http://localhost:5002';

function get(path) {
  const url = new URL(path, BASE);
  const lib = url.protocol === 'https:' ? require('https') : require('http');
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
    } else {
      console.log('  GET /api/settings FAIL', s.status);
      fail++;
    }
  } catch (e) {
    console.log('  GET /api/settings ERROR', e.message);
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
