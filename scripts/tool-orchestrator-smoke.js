#!/usr/bin/env node
/**
 * Tool Orchestrator Smoke Test
 * ─────────────────────────────
 * Verifies that the tool orchestrator layer works correctly
 * without requiring DB, API keys, or running server.
 *
 * Run:  npm run eva:tooltest          (from eva/)
 *   or: node scripts/tool-orchestrator-smoke.js
 *
 * Tests:
 *  1. buildAllTools merges correctly
 *  2. isOrchestratorTool dispatches correctly
 *  3. executeOrchestratorTool returns proper error when services are unavailable
 *  4. Tool schemas are valid for Anthropic API
 *  5. Trace utilities work
 *  6. Alice + orchestrator coexistence
 */

const {
  ORCHESTRATOR_TOOLS,
  ORCHESTRATOR_TOOL_NAMES,
  isOrchestratorTool,
  buildAllTools,
  executeOrchestratorTool,
  createTrace,
  traceToolCall,
  MAX_TOOL_ROUNDS,
} = require('../server/services/toolOrchestrator');

const { ALICE_SYSTEM, EVA_SYSTEM, getSystemPromptBase, parseCommand } = require('../server/evaChat');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  EVA Tool Orchestrator — Smoke Tests');
  console.log('══════════════════════════════════════════\n');

  // ── 1. Tool definitions ──────────────────────────────────
  console.log('▸ Tool Definitions');
  assert(ORCHESTRATOR_TOOLS.length === 4, '4 orchestrator tools defined');
  assert(ORCHESTRATOR_TOOL_NAMES.has('web_search'), 'has web_search');
  assert(ORCHESTRATOR_TOOL_NAMES.has('gmail_search'), 'has gmail_search');
  assert(ORCHESTRATOR_TOOL_NAMES.has('calendar_search'), 'has calendar_search');
  assert(ORCHESTRATOR_TOOL_NAMES.has('doc_search'), 'has doc_search');

  // ── 2. Tool schema validation ────────────────────────────
  console.log('\n▸ Tool Schema Validation');
  for (const t of ORCHESTRATOR_TOOLS) {
    assert(t.name && typeof t.name === 'string', `${t.name}: has name`);
    assert(t.description && t.description.length > 10, `${t.name}: has description`);
    assert(t.input_schema && t.input_schema.type === 'object', `${t.name}: input_schema.type=object`);
    assert(Array.isArray(t.input_schema.required), `${t.name}: has required array`);
    assert(t.input_schema.required.includes('query'), `${t.name}: requires query`);
    assert(t.input_schema.properties && t.input_schema.properties.query, `${t.name}: has query property`);
  }

  // ── 3. isOrchestratorTool ────────────────────────────────
  console.log('\n▸ isOrchestratorTool');
  assert(isOrchestratorTool('web_search') === true, 'web_search → true');
  assert(isOrchestratorTool('gmail_search') === true, 'gmail_search → true');
  assert(isOrchestratorTool('calendar_search') === true, 'calendar_search → true');
  assert(isOrchestratorTool('doc_search') === true, 'doc_search → true');
  assert(isOrchestratorTool('save_memory') === false, 'save_memory → false');
  assert(isOrchestratorTool('create_calendar_event') === false, 'create_calendar_event → false');
  assert(isOrchestratorTool('unknown_tool') === false, 'unknown_tool → false');
  assert(isOrchestratorTool('') === false, 'empty → false');
  assert(isOrchestratorTool(null) === false, 'null → false');

  // ── 4. buildAllTools ─────────────────────────────────────
  console.log('\n▸ buildAllTools');
  const existingTools = [
    { name: 'save_memory', description: 'test', input_schema: { type: 'object', properties: {}, required: [] } },
  ];
  const merged = buildAllTools(existingTools);
  assert(merged.length === existingTools.length + ORCHESTRATOR_TOOLS.length, 'merges correctly');
  assert(merged[0].name === 'save_memory', 'existing tools first');
  assert(merged[1].name === 'web_search', 'orchestrator tools after');

  // Test kill switch
  process.env.EVA_ORCHESTRATOR_TOOLS = 'false';
  const disabled = buildAllTools(existingTools);
  assert(disabled.length === existingTools.length, 'EVA_ORCHESTRATOR_TOOLS=false disables');
  delete process.env.EVA_ORCHESTRATOR_TOOLS;

  // Empty existing
  const onlyOrch = buildAllTools([]);
  assert(onlyOrch.length === ORCHESTRATOR_TOOLS.length, 'works with empty existing');

  // ── 5. Trace utilities ───────────────────────────────────
  console.log('\n▸ Trace Utilities');
  const t = createTrace('alice');
  assert(t.mode === 'alice', 'trace mode set');
  assert(t.toolCalls.length === 0, 'trace starts empty');
  assert(t.iterations === 0, 'trace iterations=0');

  traceToolCall(t, 'web_search', 150, true);
  traceToolCall(t, 'gmail_search', 80, false);
  assert(t.toolCalls.length === 2, '2 calls traced');
  assert(t.toolCalls[0].name === 'web_search', 'first call recorded');
  assert(t.toolCalls[0].ms === 150, 'timing recorded');
  assert(t.toolCalls[0].ok === true, 'success recorded');
  assert(t.toolCalls[1].ok === false, 'failure recorded');

  // ── 6. MAX_TOOL_ROUNDS ──────────────────────────────────
  console.log('\n▸ Constants');
  assert(MAX_TOOL_ROUNDS === 6, 'MAX_TOOL_ROUNDS=6');

  // ── 7. executeOrchestratorTool (graceful degradation) ───
  console.log('\n▸ executeOrchestratorTool (no services → graceful error)');
  for (const toolName of ['web_search', 'gmail_search', 'calendar_search', 'doc_search']) {
    try {
      const result = await executeOrchestratorTool(toolName, { query: 'test' }, 'test-owner');
      // Returns { ok, error, source, _ms } — should never throw (fail-closed)
      assert(typeof result === 'object' && result !== null, `${toolName}: returns object (fail-closed)`);
      assert(result.ok === false, `${toolName}: ok=false in no-service env`);
      assert(typeof result.error === 'string' && result.error.length > 0, `${toolName}: has error message`);
      assert(typeof result._ms === 'number', `${toolName}: has timing (_ms)`);
    } catch (e) {
      // Should never reach here — executeOrchestratorTool catches all errors
      assert(false, `${toolName}: unexpected throw "${e.message.slice(0, 60)}"`);
    }
  }

  // ── 8. Alice + Orchestrator coexistence ─────────────────
  console.log('\n▸ Alice + Orchestrator Coexistence');
  assert(ALICE_SYSTEM.includes('You are Alice'), 'ALICE_SYSTEM has Alice prompt');
  assert(!EVA_SYSTEM.includes('You are Alice'), 'EVA_SYSTEM does not have Alice');
  assert(getSystemPromptBase(true).includes('You are Alice'), 'getSystemPromptBase(true) → Alice');
  assert(!getSystemPromptBase(false).includes('You are Alice'), 'getSystemPromptBase(false) → EVA');

  // /alice command still works
  const cmd = parseCommand('/alice on');
  assert(cmd.command === 'alice_toggle', '/alice on parses correctly');
  assert(cmd.toggle === 'on', 'toggle=on');

  const cmd2 = parseCommand('/alice off');
  assert(cmd2.toggle === 'off', '/alice off toggle=off');

  const cmd3 = parseCommand('/alice');
  assert(cmd3.command === 'alice_toggle', '/alice (no arg) parses');
  assert(cmd3.toggle === null, '/alice (no arg) toggle=null');

  // ── Summary ──────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
