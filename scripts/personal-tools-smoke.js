#!/usr/bin/env node
/**
 * EVA Personal Tools Smoke Test
 * Run: cd eva && node scripts/personal-tools-smoke.js
 * Requires: EVA server running, DB with test owner
 *
 * Scenarios:
 * 1. Tools disabled => EVA asks minimal info (not long questionnaire)
 * 2. Auth error => EVA says reconnect, NOT airline/date
 * 3. 1 itinerary found => EVA answers with time + disambiguation only if needed
 */

const personalTools = require('../server/services/personalToolsService');

async function runSmoke() {
  console.log('=== EVA Personal Tools Smoke Test ===\n');

  // 1. Intent classification
  console.log('1. Intent classification');
  const tests = [
    ['mon vol pour Shanghai', personalTools.INTENTS.FLIGHT_QUESTION],
    ['à quelle heure est mon vol pour Shanghai', personalTools.INTENTS.FLIGHT_QUESTION],
    ['flight to PVG', personalTools.INTENTS.FLIGHT_QUESTION],
    ['e-ticket', personalTools.INTENTS.FLIGHT_QUESTION],
    ['mon meeting demain', personalTools.INTENTS.CALENDAR_QUESTION],
    ['quoi de neuf à Dubai', personalTools.INTENTS.GENERAL_NEWS],
    ['hello', personalTools.INTENTS.GENERAL_CHAT],
  ];
  for (const [msg, expected] of tests) {
    const got = personalTools.classifyIntent(msg);
    const ok = got === expected ? '✓' : '✗';
    console.log(`  ${ok} "${msg.slice(0, 35)}..." → ${got}`);
  }

  // 2. Flight email query expansion
  console.log('\n2. Flight email query expansion');
  const q = personalTools.buildFlightEmailQuery('mon vol pour Shanghai');
  console.log(`  Query: "${q}"`);
  const hasShanghai = /Shanghai|PVG|SHA/i.test(q);
  const hasItinerary = /itinerary|e-ticket|booking/i.test(q);
  console.log(`  ${hasShanghai && hasItinerary ? '✓' : '✗'} Contains destination + booking terms`);

  // 3. EVA_PERSONAL_TOOLS_ENABLED
  console.log('\n3. EVA_PERSONAL_TOOLS_ENABLED');
  const prev = process.env.EVA_PERSONAL_TOOLS_ENABLED;
  process.env.EVA_PERSONAL_TOOLS_ENABLED = 'true';
  console.log(`  enabled=true → ${personalTools.isPersonalToolsEnabled() ? '✓' : '✗'}`);
  process.env.EVA_PERSONAL_TOOLS_ENABLED = 'false';
  console.log(`  enabled=false → ${!personalTools.isPersonalToolsEnabled() ? '✓' : '✗'}`);
  delete process.env.EVA_PERSONAL_TOOLS_ENABLED;
  console.log(`  unset → ${!personalTools.isPersonalToolsEnabled() ? '✓' : '✗'}`);
  if (prev !== undefined) process.env.EVA_PERSONAL_TOOLS_ENABLED = prev;

  // 4. Auth error detection
  console.log('\n4. Auth error detection');
  const authTests = [
    [new Error('invalid_grant'), true],
    [new Error('Token has been expired'), true],
    [new Error('Some other error'), false],
  ];
  for (const [err, expected] of authTests) {
    const got = personalTools.isAuthError(err);
    console.log(`  ${got === expected ? '✓' : '✗'} ${err.message} → AUTH_ERROR=${got}`);
  }

  console.log('\n=== Smoke test complete ===');
  console.log('To test with live EVA: send "mon vol pour Shanghai" and "eva diag personal-tools"');
}

runSmoke().catch((e) => {
  console.error(e);
  process.exit(1);
});
