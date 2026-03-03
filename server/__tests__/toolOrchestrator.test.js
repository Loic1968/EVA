/**
 * Tool Orchestrator — unit tests (no DB, no API keys).
 * Run: node --test server/__tests__/toolOrchestrator.test.js  (from eva/)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  ORCHESTRATOR_TOOLS,
  ORCHESTRATOR_TOOL_NAMES,
  isOrchestratorTool,
  buildAllTools,
  createTrace,
  traceToolCall,
  MAX_TOOL_ROUNDS,
} = require('../services/toolOrchestrator');

describe('ORCHESTRATOR_TOOLS', () => {
  it('defines 4 tools', () => {
    assert.strictEqual(ORCHESTRATOR_TOOLS.length, 4);
  });

  it('has web_search, gmail_search, calendar_search, doc_search', () => {
    const names = ORCHESTRATOR_TOOLS.map((t) => t.name);
    assert.ok(names.includes('web_search'));
    assert.ok(names.includes('gmail_search'));
    assert.ok(names.includes('calendar_search'));
    assert.ok(names.includes('doc_search'));
  });

  it('each tool has name, description, input_schema', () => {
    for (const t of ORCHESTRATOR_TOOLS) {
      assert.ok(t.name, 'tool must have name');
      assert.ok(t.description, 'tool must have description');
      assert.ok(t.input_schema, 'tool must have input_schema');
      assert.strictEqual(t.input_schema.type, 'object');
      assert.ok(Array.isArray(t.input_schema.required), 'must have required array');
    }
  });

  it('all tools require query', () => {
    for (const t of ORCHESTRATOR_TOOLS) {
      assert.ok(t.input_schema.required.includes('query'), `${t.name} must require query`);
    }
  });
});

describe('isOrchestratorTool', () => {
  it('returns true for orchestrator tools', () => {
    assert.ok(isOrchestratorTool('web_search'));
    assert.ok(isOrchestratorTool('gmail_search'));
    assert.ok(isOrchestratorTool('calendar_search'));
    assert.ok(isOrchestratorTool('doc_search'));
  });

  it('returns false for non-orchestrator tools', () => {
    assert.ok(!isOrchestratorTool('save_memory'));
    assert.ok(!isOrchestratorTool('create_calendar_event'));
    assert.ok(!isOrchestratorTool('delete_calendar_event'));
    assert.ok(!isOrchestratorTool('create_draft'));
    assert.ok(!isOrchestratorTool('unknown_tool'));
  });
});

describe('buildAllTools', () => {
  const existingTools = [
    { name: 'save_memory', description: 'test', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'create_calendar_event', description: 'test', input_schema: { type: 'object', properties: {}, required: [] } },
  ];

  it('merges existing tools with orchestrator tools', () => {
    const all = buildAllTools(existingTools);
    assert.strictEqual(all.length, existingTools.length + ORCHESTRATOR_TOOLS.length);
  });

  it('puts existing tools first, orchestrator tools after', () => {
    const all = buildAllTools(existingTools);
    assert.strictEqual(all[0].name, 'save_memory');
    assert.strictEqual(all[1].name, 'create_calendar_event');
    assert.strictEqual(all[2].name, 'web_search');
  });

  it('respects EVA_ORCHESTRATOR_TOOLS=false', () => {
    process.env.EVA_ORCHESTRATOR_TOOLS = 'false';
    const all = buildAllTools(existingTools);
    assert.strictEqual(all.length, existingTools.length);
    delete process.env.EVA_ORCHESTRATOR_TOOLS;
  });

  it('returns orchestrator tools when called with empty array', () => {
    const all = buildAllTools([]);
    assert.strictEqual(all.length, ORCHESTRATOR_TOOLS.length);
  });
});

describe('trace', () => {
  it('createTrace initializes correctly', () => {
    const t = createTrace('alice');
    assert.strictEqual(t.mode, 'alice');
    assert.deepStrictEqual(t.toolCalls, []);
    assert.strictEqual(t.iterations, 0);
  });

  it('traceToolCall appends entries', () => {
    const t = createTrace('eva_standard');
    traceToolCall(t, 'web_search', 120, true);
    traceToolCall(t, 'gmail_search', 85, false);
    assert.strictEqual(t.toolCalls.length, 2);
    assert.deepStrictEqual(t.toolCalls[0], { name: 'web_search', ms: 120, ok: true });
    assert.deepStrictEqual(t.toolCalls[1], { name: 'gmail_search', ms: 85, ok: false });
  });
});

describe('MAX_TOOL_ROUNDS', () => {
  it('defaults to 6', () => {
    assert.strictEqual(MAX_TOOL_ROUNDS, 6);
  });
});

describe('evaChat integration', () => {
  const evaChat = require('../evaChat');

  it('exports buildAllTools-derived tools (CALENDAR_TOOLS + orchestrator)', () => {
    // parseCommand still works
    const r = evaChat.parseCommand('/alice on');
    assert.strictEqual(r.command, 'alice_toggle');
  });

  it('ALICE_SYSTEM still includes Alice prompt', () => {
    assert.ok(evaChat.ALICE_SYSTEM.includes('You are Alice'));
  });

  it('EVA_SYSTEM does not include Alice', () => {
    assert.ok(!evaChat.EVA_SYSTEM.includes('You are Alice'));
  });
});
