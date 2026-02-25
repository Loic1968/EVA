#!/usr/bin/env node
/**
 * Test script for EVA structured memory (eva.facts).
 * Run: EVA_STRUCTURED_MEMORY=true node server/scripts/testStructuredMemory.js
 * Requires: DATABASE_URL, eva.facts table (migration 007), ANTHROPIC_API_KEY
 *
 * Test flow:
 * 1) Insert fact date_of_birth
 * 2) Ask EVA (LLM uses injected facts)
 * 3) "Restart" context (new request)
 * 4) Ask again
 * 5) Confirm same answer
 * 6) Insert correction
 * 7) Ask again
 * 8) Confirm corrected answer persists
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

process.env.EVA_STRUCTURED_MEMORY = 'true';

const db = require('../db');
const evaChat = require('../evaChat');
const factsService = require('../services/factsService');

const TEST_EMAIL = process.env.EVA_TEST_OWNER_EMAIL || 'eva-structured-memory-test@halisoft.biz';

async function run() {
  console.log('EVA Structured Memory Test');
  console.log('EVA_STRUCTURED_MEMORY:', process.env.EVA_STRUCTURED_MEMORY);
  console.log('');

  const owner = await db.getOrCreateOwner(TEST_EMAIL, 'Test Owner');
  const ownerId = owner.id;
  console.log('Owner ID:', ownerId);

  // Ensure eva.facts exists
  try {
    await db.query('SELECT 1 FROM eva.facts LIMIT 1');
  } catch (e) {
    if (/relation "eva\.facts" does not exist/i.test(String(e.message))) {
      console.error('ERROR: eva.facts table missing. Run: psql "$DATABASE_URL" -f eva/migrations/007_add_facts.sql');
      process.exit(1);
    }
    throw e;
  }

  // Clean slate for test key
  await factsService.deleteFact(ownerId, 'date_of_birth');

  // 1) Insert fact
  const id1 = await factsService.upsertFactSafe(ownerId, 'date_of_birth', '15 mars 1985', 'conversation', null, 50);
  console.log('1. Inserted date_of_birth = 15 mars 1985, id:', id1);
  if (!id1) {
    console.error('FAIL: Could not insert fact');
    process.exit(1);
  }

  // 2) Ask EVA
  const r1 = await evaChat.reply('Quelle est ma date de naissance ?', [], ownerId);
  console.log('2. First ask:', r1.reply);
  if (!r1.reply || !r1.reply.includes('15 mars 1985')) {
    console.error('FAIL: Expected "15 mars 1985" in reply, got:', r1.reply);
    process.exit(1);
  }
  console.log('   OK');

  // 3-4) "Restart" = new request, ask again
  const r2 = await evaChat.reply('Ma date de naissance ?', [], ownerId);
  console.log('4. Second ask (after "restart"):', r2.reply);
  if (!r2.reply || !r2.reply.includes('15 mars 1985')) {
    console.error('FAIL: Expected same answer "15 mars 1985", got:', r2.reply);
    process.exit(1);
  }
  console.log('   OK — same answer persists');

  // 5) Insert correction
  const id2 = await factsService.addCorrection(ownerId, 'date_of_birth', '16 mars 1985');
  console.log('6. Inserted correction: date_of_birth = 16 mars 1985, id:', id2);

  // 6-7) Ask again
  const r3 = await evaChat.reply('C\'est quoi ma date de naissance ?', [], ownerId);
  console.log('7. After correction:', r3.reply);
  if (!r3.reply || !r3.reply.includes('16 mars 1985')) {
    console.error('FAIL: Expected corrected "16 mars 1985", got:', r3.reply);
    process.exit(1);
  }
  console.log('   OK — correction persists');

  // Cleanup
  await factsService.deleteFact(ownerId, 'date_of_birth');
  console.log('\nAll tests passed. Cleaned up test fact.');
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
