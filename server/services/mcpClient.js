/**
 * MCP Client — connects EVA to the Halisoft MCP Hub via stdio.
 *
 * Spawns the mcp-hub server.js as a child process, communicates over
 * JSON-RPC 2.0 (one JSON line per message, same as Cursor/Claude Code).
 *
 * Lifecycle:
 *   1. connect()      → spawn process, send 'initialize', cache tools/list
 *   2. callTool(name, args) → tools/call, return result
 *   3. disconnect()   → kill child process
 *
 * Lazy: the child is NOT spawned until the first connect() call.
 */

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MCP_SERVER_PATH = process.env.MCP_SERVER_PATH ||
  path.resolve(__dirname, '../mcp-hub/core/server.js');

const MCP_PROJECT_ROOT = process.env.MCP_PROJECT_ROOT ||
  path.resolve(__dirname, '../../');

const CONNECT_TIMEOUT_MS = Number(process.env.MCP_CONNECT_TIMEOUT_MS) || 10000;
const CALL_TIMEOUT_MS    = Number(process.env.MCP_CALL_TIMEOUT_MS) || 20000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let child = null;           // ChildProcess
let rl = null;              // readline on child.stdout
let connected = false;
let lastError = null;       // last connection error message
let pendingRequests = {};   // id → { resolve, reject, timer }
let nextId = 1;
let cachedTools = null;     // tools/list result cache

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!child || !connected) {
      return reject(new Error('MCP client not connected'));
    }

    const id = nextId++;
    const timeout = method === 'initialize' ? CONNECT_TIMEOUT_MS : CALL_TIMEOUT_MS;

    const timer = setTimeout(() => {
      delete pendingRequests[id];
      reject(new Error(`MCP ${method} timed out after ${timeout}ms`));
    }, timeout);

    pendingRequests[id] = { resolve, reject, timer };

    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    try {
      child.stdin.write(msg);
    } catch (err) {
      clearTimeout(timer);
      delete pendingRequests[id];
      reject(new Error(`MCP write failed: ${err.message}`));
    }
  });
}

function handleLine(line) {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.warn('[mcpClient] Non-JSON line from MCP server:', line.slice(0, 200));
    return;
  }

  const id = msg.id;
  if (id != null && pendingRequests[id]) {
    const { resolve, reject, timer } = pendingRequests[id];
    clearTimeout(timer);
    delete pendingRequests[id];

    if (msg.error) {
      reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      resolve(msg.result);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Spawn the MCP server and initialize the connection.
 * Returns true on success, false on failure (non-throwing).
 */
async function connect() {
  if (connected) return true;

  try {
    // Spawn mcp-hub server
    child = spawn('node', [MCP_SERVER_PATH], {
      cwd: MCP_PROJECT_ROOT,
      env: {
        ...process.env,
        MCP_PROJECT_ROOT,
        MCP_ACTOR_ID: process.env.MCP_ACTOR_ID || 'eva-assistant',
        MCP_ACTOR_ROLE: process.env.MCP_ACTOR_ROLE || 'platform_admin',
        MCP_TENANT_ID: process.env.MCP_TENANT_ID || '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle child stderr (log but don't crash)
    child.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.warn('[mcpClient:stderr]', msg);
    });

    // Handle child exit
    child.on('exit', (code) => {
      console.log(`[mcpClient] MCP server exited with code ${code}`);
      connected = false;
      child = null;
      // Reject all pending requests
      for (const id of Object.keys(pendingRequests)) {
        const { reject, timer } = pendingRequests[id];
        clearTimeout(timer);
        reject(new Error('MCP server exited'));
        delete pendingRequests[id];
      }
    });

    child.on('error', (err) => {
      console.error('[mcpClient] MCP server process error:', err.message);
      connected = false;
    });

    // Parse stdout line by line (JSON-RPC responses)
    rl = readline.createInterface({ input: child.stdout });
    rl.on('line', handleLine);

    connected = true;
    lastError = null;

    // Send initialize
    const initResult = await sendRequest('initialize');
    console.log('[mcpClient] Connected to MCP Hub:', initResult?.serverInfo?.name, initResult?.serverInfo?.version);

    // Cache available tools
    const toolsResult = await sendRequest('tools/list');
    cachedTools = (toolsResult?.tools || []).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    console.log(`[mcpClient] ${cachedTools.length} MCP tools available:`, cachedTools.map(t => t.name).join(', '));

    return true;
  } catch (err) {
    lastError = err.message;
    console.error('[mcpClient] Connect failed:', err.message);
    disconnect();
    return false;
  }
}

/**
 * Call an MCP tool by name. Returns { ok, data, error, source }.
 * Matches the toolOrchestrator result format.
 */
async function callTool(toolName, args = {}, context = {}) {
  if (!connected) {
    const ok = await connect();
    if (!ok) return { ok: false, error: 'MCP server not available', source: toolName };
  }

  try {
    const result = await sendRequest('tools/call', {
      name: toolName,
      arguments: {
        ...args,
        _context: {
          actor_id: context.actor_id || process.env.MCP_ACTOR_ID || 'eva-assistant',
          actor_role: context.actor_role || process.env.MCP_ACTOR_ROLE || 'platform_admin',
          tenant_id: context.tenant_id || null,
        },
      },
    });

    // Parse MCP response content
    const content = result?.content || [];
    let data;
    if (content.length > 0 && content[0]?.text) {
      try {
        data = JSON.parse(content[0].text);
      } catch {
        data = content[0].text;
      }
    } else {
      data = content;
    }

    if (result?.isError) {
      return { ok: false, error: typeof data === 'object' ? (data.error || JSON.stringify(data)) : String(data), source: toolName };
    }
    return { ok: true, data: typeof data === 'object' ? (data.data ?? data) : data, source: toolName };
  } catch (err) {
    return { ok: false, error: err.message, source: toolName };
  }
}

/**
 * List available MCP tools (cached after connect).
 * Returns array of { name, description, inputSchema }.
 */
function listTools() {
  return cachedTools || [];
}

/**
 * Check if a tool name belongs to MCP hub.
 */
function isMcpTool(name) {
  if (!cachedTools) return false;
  return cachedTools.some(t => t.name === name);
}

/**
 * Sanitize JSON Schema for Claude API (requires draft 2020-12, no $ref).
 * MCP tools may have $ref, $schema, or other invalid keywords.
 */
function sanitizeSchemaForClaude(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const s = schema.schema || schema;
  if (typeof s !== 'object') return { type: 'object', properties: {} };
  if (s.$ref) return { type: 'object', properties: {} };
  const out = { type: 'object', properties: {} };
  if (s.properties && typeof s.properties === 'object') {
    for (const [k, v] of Object.entries(s.properties)) {
      if (!v || v.$ref) continue;
      if (typeof v === 'object' && !Array.isArray(v) && v.properties) {
        out.properties[k] = sanitizeSchemaForClaude(v);
      } else {
        out.properties[k] = { type: (v.type && ['string','number','integer','boolean','array','object'].includes(v.type)) ? v.type : 'string', description: v.description };
      }
    }
  }
  if (s.required && Array.isArray(s.required)) {
    out.required = s.required.filter((r) => typeof r === 'string');
  }
  return out;
}

/**
 * Build Claude-compatible tool schemas from MCP tools.
 * Sanitizes input_schema to comply with JSON Schema draft 2020-12 (no $ref).
 */
function buildMcpToolSchemas() {
  if (!cachedTools || cachedTools.length === 0) return [];
  return cachedTools.map(t => ({
    name: `mcp_${t.name.replace(/\./g, '_')}`,
    description: `[MCP] ${t.description || t.name}`,
    input_schema: sanitizeSchemaForClaude(t.inputSchema || { type: 'object', properties: {} }),
  }));
}

/**
 * Disconnect: kill the MCP server child process.
 */
function disconnect() {
  connected = false;
  cachedTools = null;
  if (rl) { try { rl.close(); } catch {} rl = null; }
  if (child) {
    try { child.kill('SIGTERM'); } catch {}
    child = null;
  }
  // Clean up pending requests
  for (const id of Object.keys(pendingRequests)) {
    const { reject, timer } = pendingRequests[id];
    clearTimeout(timer);
    reject(new Error('MCP client disconnected'));
    delete pendingRequests[id];
  }
}

/**
 * Is the MCP client connected?
 */
function isConnected() {
  return connected;
}

/**
 * Get MCP status summary (for /mcp/status endpoint and UI).
 */
function getStatus() {
  return {
    connected,
    error: lastError,
    tools_count: cachedTools ? cachedTools.length : 0,
  };
}

module.exports = {
  connect,
  disconnect,
  callTool,
  listTools,
  isMcpTool,
  buildMcpToolSchemas,
  isConnected,
  getStatus,
};
