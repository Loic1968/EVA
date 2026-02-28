#!/usr/bin/env node
/**
 * Vérifie que EVA est accessible.
 * Usage: node eva/scripts/check-eva-reachability.js
 */
const http = require('http');

const PORTS = { frontend: 3001, backend: 5002 };

function probe(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/', method: 'GET' },
      (res) => resolve({ ok: true, status: res.statusCode })
    );
    req.on('error', () => resolve({ ok: false }));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.end();
  });
}

async function main() {
  console.log('EVA Reachability Check\n');
  const backend = await probe(PORTS.backend);
  const frontend = await probe(PORTS.frontend);

  console.log(`Backend (port ${PORTS.backend}): ${backend.ok ? '✓ OK' : '✗ NOT REACHABLE'}`);
  console.log(`Frontend (port ${PORTS.frontend}): ${frontend.ok ? '✓ OK' : '✗ NOT REACHABLE'}`);

  if (!backend.ok || !frontend.ok) {
    console.log('\n→ Lancer EVA: cd eva && npm run dev');
    process.exit(1);
  }

  console.log('\nURLs:');
  console.log(`  http://localhost:${PORTS.frontend}`);
  console.log(`  http://localhost:${PORTS.frontend}/eva/chat`);
  console.log(`  http://localhost:${PORTS.frontend}/chat-pure`);
  console.log('\nDepuis un autre appareil (même WiFi):');
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) {
        console.log(`  http://${n.address}:${PORTS.frontend}/eva/chat`);
        break;
      }
    }
  }
}

main().catch(console.error);
