/**
 * EVA Phase 1 — light unit tests (command parsing, no DB/AI).
 * Run: node --test server/__tests__/evaChat.test.js  (from eva/)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseCommand, MODE_HINTS } = require('../evaChat');

describe('parseCommand', () => {
  it('parses /reset', () => {
    const r = parseCommand('/reset');
    assert.strictEqual(r.command, 'reset');
    assert.strictEqual(r.mode, null);
    assert.strictEqual(r.message, '');
  });

  it('parses /reset with trailing text', () => {
    const r = parseCommand('/reset start fresh');
    assert.strictEqual(r.command, 'reset');
    assert.strictEqual(r.message, 'start fresh');
  });

  it('parses /brief', () => {
    const r = parseCommand('/brief summarize this');
    assert.strictEqual(r.command, 'brief');
    assert.strictEqual(r.mode, 'BRIEF_ME');
    assert.strictEqual(r.message, 'summarize this');
  });

  it('parses /draft', () => {
    const r = parseCommand('/draft email to client');
    assert.strictEqual(r.command, 'draft');
    assert.strictEqual(r.mode, 'DRAFT_REVIEW');
    assert.strictEqual(r.message, 'email to client');
  });

  it('parses /execute', () => {
    const r = parseCommand('/execute send the report');
    assert.strictEqual(r.command, 'execute');
    assert.strictEqual(r.mode, 'EXECUTE_GUARDED');
    assert.strictEqual(r.message, 'send the report');
  });

  it('returns null command for normal message', () => {
    const r = parseCommand('Hello world');
    assert.strictEqual(r.command, null);
    assert.strictEqual(r.mode, null);
    assert.strictEqual(r.message, 'Hello world');
  });

  it('handles case-insensitive commands', () => {
    assert.strictEqual(parseCommand('/RESET').command, 'reset');
    assert.strictEqual(parseCommand('/Brief x').command, 'brief');
  });
});

describe('MODE_HINTS', () => {
  it('has hints for all mode commands', () => {
    assert.ok(MODE_HINTS.BRIEF_ME);
    assert.ok(MODE_HINTS.DRAFT_REVIEW);
    assert.ok(MODE_HINTS.EXECUTE_GUARDED);
  });
});
