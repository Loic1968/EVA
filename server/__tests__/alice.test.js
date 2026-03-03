/**
 * Alice persona integration — unit tests (no DB/AI).
 * Run: node --test server/__tests__/alice.test.js  (from eva/)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Alice prompt', () => {
  const { ALICE_PROMPT, getAlicePrompt } = require('../prompts/alicePrompt');

  it('exports ALICE_PROMPT string', () => {
    assert.ok(typeof ALICE_PROMPT === 'string');
    assert.ok(ALICE_PROMPT.length > 200);
  });

  it('getAlicePrompt() returns same string', () => {
    assert.strictEqual(getAlicePrompt(), ALICE_PROMPT);
  });

  it('prompt includes Alice identity', () => {
    assert.ok(ALICE_PROMPT.includes('You are Alice'));
  });

  it('prompt includes sign-off instruction', () => {
    assert.ok(ALICE_PROMPT.includes('— Alice'));
  });

  it('prompt mentions Loic by name', () => {
    assert.ok(ALICE_PROMPT.includes('Loic'));
  });

  it('prompt covers morning briefing behavior', () => {
    assert.ok(ALICE_PROMPT.includes('MORNING BRIEFING'));
    assert.ok(ALICE_PROMPT.includes('calendar'));
    assert.ok(ALICE_PROMPT.includes('email'));
  });

  it('prompt includes anti-hallucination reference', () => {
    assert.ok(ALICE_PROMPT.includes('Never invents data'));
  });

  it('prompt covers language matching', () => {
    assert.ok(ALICE_PROMPT.includes('French'));
    assert.ok(ALICE_PROMPT.includes('English'));
  });
});

describe('parseCommand — /alice', () => {
  const { parseCommand } = require('../evaChat');

  it('parses /alice (toggle)', () => {
    const r = parseCommand('/alice');
    assert.strictEqual(r.command, 'alice_toggle');
    assert.strictEqual(r.toggle, null);
  });

  it('parses /alice on', () => {
    const r = parseCommand('/alice on');
    assert.strictEqual(r.command, 'alice_toggle');
    assert.strictEqual(r.toggle, 'on');
  });

  it('parses /alice off', () => {
    const r = parseCommand('/alice off');
    assert.strictEqual(r.command, 'alice_toggle');
    assert.strictEqual(r.toggle, 'off');
  });

  it('parses /ALICE ON (case insensitive)', () => {
    const r = parseCommand('/ALICE ON');
    assert.strictEqual(r.command, 'alice_toggle');
    assert.strictEqual(r.toggle, 'on');
  });

  it('does NOT match /alice followed by other text', () => {
    const r = parseCommand('/alice tell me something');
    assert.strictEqual(r.command, null); // normal message, not a command
  });
});

describe('getSystemPromptBase', () => {
  const { getSystemPromptBase, EVA_SYSTEM, ALICE_SYSTEM } = require('../evaChat');

  it('returns EVA_SYSTEM when isAlice=false', () => {
    assert.strictEqual(getSystemPromptBase(false), EVA_SYSTEM);
  });

  it('returns ALICE_SYSTEM when isAlice=true', () => {
    assert.strictEqual(getSystemPromptBase(true), ALICE_SYSTEM);
  });

  it('ALICE_SYSTEM contains Alice prompt', () => {
    assert.ok(ALICE_SYSTEM.includes('You are Alice'));
    assert.ok(ALICE_SYSTEM.includes('— Alice'));
  });

  it('ALICE_SYSTEM includes anti-hallucination rules', () => {
    assert.ok(ALICE_SYSTEM.includes('NE JAMAIS inventer'));
  });

  it('ALICE_SYSTEM includes shared capabilities', () => {
    assert.ok(ALICE_SYSTEM.includes('Documents / Emails / Calendar'));
  });

  it('EVA_SYSTEM does NOT contain Alice', () => {
    assert.ok(!EVA_SYSTEM.includes('You are Alice'));
  });
});
