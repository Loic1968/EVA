#!/usr/bin/env node
/**
 * EVA Assistant intelligence tests.
 * Run: EVA_STRUCTURED_MEMORY=true EVA_ASSISTANT_MODE=true node eva/server/scripts/testAssistant.js
 * Requires: DATABASE_URL or EVA_DATABASE_URL, and at least one eva.owners row.
 */
const path = require('path');
const fs = require('fs');
const parentEnv = path.join(__dirname, '../../../.env');
const evaEnv = path.join(__dirname, '../../.env');
if (fs.existsSync(parentEnv)) require('dotenv').config({ path: parentEnv });
if (fs.existsSync(evaEnv)) require('dotenv').config({ path: evaEnv });

const db = require('../db');
const factsService = require('../services/factsService');
const preAnswerService = require('../services/preAnswerService');
const intentRouter = require('../intentRouter');

async function getTestOwnerId() {
  const r = await db.query('SELECT id FROM eva.owners LIMIT 1');
  if (!r.rows[0]) throw new Error('No eva.owners row. Create one first.');
  return r.rows[0].id;
}

const tests = [];

async function testStoreDobPersistence() {
  const ownerId = await getTestOwnerId();
  const key = 'date_of_birth';
  const value = '15 mars 1985';
  await factsService.addCorrection(ownerId, key, value);
  const fact = await factsService.getFactByKey(ownerId, key);
  const ok = fact && fact.value === value;
  tests.push({ name: 'store DOB → persistence', ok, detail: ok ? 'OK' : `Expected "${value}", got ${fact?.value}` });
}

async function testCorrectFlightDate() {
  const ownerId = await getTestOwnerId();
  await factsService.addRemember(ownerId, 'departure_date', '1 mars 2026');
  await factsService.addCorrection(ownerId, 'departure_date', '2 mars 2026');
  const fact = await factsService.getFactByKey(ownerId, 'departure_date');
  const ok = fact && fact.value === '2 mars 2026' && (fact.source_type || '').toLowerCase() === 'correction';
  tests.push({ name: 'correct flight date → persistence', ok, detail: ok ? 'OK' : `Expected "2 mars 2026" (correction), got ${fact?.value}` });
}

async function testStatusFromPreAnswer() {
  const ownerId = await getTestOwnerId();
  await factsService.addRemember(ownerId, 'insurance', 'awaiting Policybazaar reply');
  const preAnswer = await preAnswerService.tryPreAnswer(ownerId, "Où on en est sur mon assurance?");
  const ok = preAnswer && (preAnswer.reply?.includes('awaiting') || preAnswer.reply?.includes('Policybazaar'));
  tests.push({ name: 'status question → uses stored state', ok, detail: ok ? 'OK' : `PreAnswer: ${JSON.stringify(preAnswer)}` });
}

async function testNoContradictionAfterCorrection() {
  const ownerId = await getTestOwnerId();
  await factsService.addRemember(ownerId, 'test_fact', 'original');
  await factsService.addCorrection(ownerId, 'test_fact', 'corrected');
  const fact = await factsService.getFactByKey(ownerId, 'test_fact');
  const ok = fact && fact.value === 'corrected';
  tests.push({ name: 'no contradiction after correction', ok, detail: ok ? 'OK' : `Should be "corrected", got ${fact?.value}` });
}

async function testIdentityQueryReturnsFullName() {
  const ownerId = await getTestOwnerId();
  const expectedName = 'Jean Dupont';
  await factsService.addRemember(ownerId, 'full_name', expectedName);
  const intent = intentRouter.detectIntent("comment je m'appelle ?");
  const okIntent = intent === intentRouter.INTENTS.IDENTITY_QUERY;
  const reply = await intentRouter.resolveIdentityQuery(ownerId, "comment je m'appelle ?");
  const okReply = reply === expectedName;
  const noStripe = !reply.toLowerCase().includes('stripe');
  const ok = okIntent && okReply && noStripe;
  tests.push({
    name: 'identity query "comment je m\'appelle ?" → full_name from eva.facts, no Stripe',
    ok,
    detail: ok
      ? 'OK'
      : `intent=${intent} (expected IDENTITY_QUERY), reply="${reply}" (expected "${expectedName}"), noStripe=${noStripe}`,
  });
}

async function run() {
  console.log('[EVA Assistant Tests]');
  console.log('EVA_STRUCTURED_MEMORY:', process.env.EVA_STRUCTURED_MEMORY);
  console.log('EVA_ASSISTANT_MODE:', process.env.EVA_ASSISTANT_MODE);
  console.log('');

  try {
    await testStoreDobPersistence();
    await testCorrectFlightDate();
    await testStatusFromPreAnswer();
    await testNoContradictionAfterCorrection();
    await testIdentityQueryReturnsFullName();

    const passed = tests.filter((t) => t.ok).length;
    const failed = tests.filter((t) => !t.ok);
    tests.forEach((t) => console.log(`${t.ok ? '✓' : '✗'} ${t.name}: ${t.detail}`));
    console.log('');
    console.log(`Result: ${passed}/${tests.length} passed`);
    if (failed.length > 0) process.exit(1);
  } catch (e) {
    console.error('Test failed:', e.message);
    process.exit(1);
  } finally {
    try {
      await db.getPool()?.end?.();
    } catch (_) {}
  }
}

run();
