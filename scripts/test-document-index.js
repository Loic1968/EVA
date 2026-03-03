#!/usr/bin/env node
/**
 * Test document indexing (Claude extraction).
 * Usage: cd eva && node scripts/test-document-index.js
 * Requires: ANTHROPIC_API_KEY or CLAUDE_API_KEY in .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const key = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
if (!key) {
  console.error('ANTHROPIC_API_KEY or CLAUDE_API_KEY not set.');
  process.exit(1);
}

async function main() {
  console.log('EVA document index test\n');
  console.log('Key:', key.slice(0, 12) + '...');
  console.log('Model:', process.env.EVA_DOCUMENT_MODEL || process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514');

  const docProcessor = require('../server/services/documentProcessor');
  // Minimal valid PDF (empty page) - tests Claude PDF API
  const minimalPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF',
    'utf-8'
  );

  console.log('\nTesting PDF extraction (minimal PDF)...');
  try {
    const text = await docProcessor.extractText(minimalPdf, 'pdf', 'test.pdf');
    if (text && text.length > 0) {
      console.log('OK – extracted', text.length, 'chars');
    } else {
      console.log('OK – Claude processed (empty doc → no text)');
    }
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
  console.log('\nDocument indexing: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
