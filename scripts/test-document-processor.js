#!/usr/bin/env node
/**
 * Production test for documentProcessor (PDF + image AI extraction).
 * Requires: ANTHROPIC_API_KEY or CLAUDE_API_KEY
 * Run: ANTHROPIC_API_KEY=sk-... node scripts/test-document-processor.js
 * Or: dotenv + .env with key
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const path = require('path');
const fs = require('fs');

const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

async function run() {
  const dp = require('../server/services/documentProcessor');
  console.log('documentProcessor:', typeof dp.extractText, typeof dp.reindexAllDocuments);
  console.log('ANTHROPIC_API_KEY:', hasKey ? 'set' : 'MISSING — PDF/image AI will skip\n');

  // 1. TXT (no API)
  const txt = Buffer.from('Hello world test extraction');
  const r = await dp.extractText(txt, 'txt');
  console.log('1. TXT:', r === 'Hello world test extraction' ? 'OK' : 'FAIL');

  // 2. PDF (pdf-parse + Claude fallback)
  const pdfPath = path.join(__dirname, '../../qa/fixtures/invoice_1.pdf');
  if (fs.existsSync(pdfPath)) {
    const pdf = fs.readFileSync(pdfPath);
    const pr = await dp.extractText(pdf, 'pdf');
    console.log('2. PDF:', pr && pr.length > 20 ? `OK (${pr.length} chars)` : pr ? `short (${pr.length})` : 'null');
  } else {
    console.log('2. PDF: no qa/fixtures/invoice_1.pdf, skip');
  }

  // 3. Image (Claude vision)
  const imgPath = path.join(__dirname, '../../qa/fixtures');
  const pngFiles = fs.existsSync(imgPath) ? fs.readdirSync(imgPath).filter((f) => /\.(png|jpg|jpeg)$/i.test(f)) : [];
  if (pngFiles.length > 0) {
    const buf = fs.readFileSync(path.join(imgPath, pngFiles[0]));
    const ext = path.extname(pngFiles[0]).replace('.', '').toLowerCase() || 'png';
    const img = await dp.extractText(buf, ext);
    console.log('3. Image:', img ? `OK (${img.length} chars)` : 'null');
  } else {
    const minimalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const img = await dp.extractText(minimalPng, 'png');
    console.log('3. Image (1x1):', img !== undefined ? 'OK' : 'FAIL', img ? `(${img.length} chars)` : '(no text)');
  }

  console.log('\nDone. Set ANTHROPIC_API_KEY for full AI extraction in prod.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
