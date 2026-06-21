/**
 * Unit tests for the auto-learning pure helpers (no DB / no network).
 * Run: node server/scripts/testAutoLearn.js
 */
const { __test } = require('../services/conversationLearningService');
const { lastUserAssistantTurn, isTrivialUserMessage, parseExtractedFacts, asText } = __test;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

// --- lastUserAssistantTurn ---
const h = [
  { role: 'user', content: 'old' },
  { role: 'assistant', content: 'x' },
  { role: 'user', content: 'I live in Shanghai and run GTTL' },
  { role: 'assistant', content: 'Noted' },
];
const t = lastUserAssistantTurn(h);
ok('turn.user', t && t.user === 'I live in Shanghai and run GTTL');
ok('turn.assistant', t && t.assistant === 'Noted');
ok('no assistant -> null', lastUserAssistantTurn([{ role: 'user', content: 'hi' }]) === null);
ok('content blocks join', asText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]) === 'a  b');

// --- isTrivialUserMessage ---
ok('short trivial', isTrivialUserMessage('ok') === true);
ok('greeting trivial', isTrivialUserMessage('bonjour') === true);
ok('pure ack trivial', isTrivialUserMessage('merci') === true);
ok('slash trivial', isTrivialUserMessage('/remember x=y') === true);
ok('substantive not trivial', isTrivialUserMessage('I live in Shanghai and run GTTL') === false);
ok('ack+fact NOT skipped (conservative)', isTrivialUserMessage('merci, je vis a Shanghai') === false);

// --- parseExtractedFacts ---
ok('plain array', JSON.stringify(parseExtractedFacts('[{"key":"home_city","value":"Shanghai"}]')) === JSON.stringify([{ key: 'home_city', value: 'Shanghai' }]));
ok('code fence + prose', parseExtractedFacts('Sure:\n```json\n[{"key":"a","value":"b"}]\n```').length === 1);
ok('empty array', parseExtractedFacts('[]').length === 0);
ok('garbage -> []', parseExtractedFacts('no json here').length === 0);
ok('drops empty key/value', parseExtractedFacts('[{"key":"","value":"x"},{"key":"k","value":""},{"key":"good","value":"v"}]').length === 1);
ok('caps at 6', parseExtractedFacts(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ key: 'k' + i, value: 'v' })))).length === 6);
ok('trims long value to 200', parseExtractedFacts('[{"key":"k","value":"' + 'x'.repeat(500) + '"}]')[0].value.length === 200);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
