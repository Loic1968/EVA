#!/usr/bin/env node
/**
 * Test web-assist logic (Tavily) — no server needed.
 * Usage: cd eva && node scripts/test-web-assist.js
 * Requires: TAVILY_API_KEY in .env (parent or eva/)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const ws = require('../server/services/webSearchService');

async function main() {
  console.log('EVA web-assist test\n');
  console.log('TAVILY_API_KEY:', ws.isAvailable() ? 'OK' : 'MISSING');

  const tests = [
    'Il se passe quoi à Dubaï?',
    "C'est quoi la situation à Paris?",
    'Quoi de neuf?',
    'Bonjour',
  ];

  for (const txt of tests) {
    const need = ws.needsWebSearch(txt);
    const isNews = ws.isNewsQuery(txt);
    const query = ws.extractQuery(txt);
    console.log(`\n"${txt}"`);
    console.log('  needsWebSearch:', need, '| isNewsQuery:', isNews, '| query:', query);
    if (need && ws.isAvailable()) {
      try {
        const data = await ws.search(query || txt, { maxResults: 3, topic: isNews ? 'news' : 'general' });
        const ctx = ws.formatForContext(data);
        console.log('  Tavily results:', data?.results?.length || 0);
        console.log('  webContext length:', ctx?.length || 0, 'chars');
      } catch (e) {
        console.log('  Tavily error:', e.message);
      }
    }
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
