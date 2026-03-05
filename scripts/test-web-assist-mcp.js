#!/usr/bin/env node
/**
 * Test EVA Realtime web-assist via MCP (web.search).
 * Run: cd eva && node scripts/test-web-assist-mcp.js
 * Requires: eva/.env with TAVILY_API_KEY (or mcp-hub uses DuckDuckGo fallback)
 */
require('dotenv').config();
const path = require('path');
const baseEnv = path.resolve(__dirname, '../../.env');
const evaEnv = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: baseEnv });
require('dotenv').config({ path: evaEnv, override: true });

async function test() {
  console.log('=== EVA web-assist MCP Test ===\n');

  // 1. MCP path
  const mcpPath = process.env.MCP_SERVER_PATH || path.resolve(__dirname, '../../mcp-hub/dist/core/server.js');
  const fs = require('fs');
  console.log('MCP_SERVER_PATH:', mcpPath);
  console.log('server.js exists:', fs.existsSync(mcpPath));
  if (!fs.existsSync(mcpPath)) {
    console.error('Run: cd mcp-hub && npm run build');
    process.exit(1);
  }

  // 2. TAVILY_API_KEY (optional - mcp-hub falls back to DuckDuckGo)
  const hasTavily = !!(process.env.TAVILY_API_KEY || '').trim();
  console.log('TAVILY_API_KEY set:', hasTavily);

  // 3. Connect MCP and call web.search
  const mcpClient = require('../server/services/mcpClient');
  console.log('\nConnecting to MCP...');
  const connected = await mcpClient.connect();
  if (!connected) {
    console.error('MCP connect failed. Check mcp-hub build and env.');
    process.exit(1);
  }
  console.log('MCP connected. Tools:', mcpClient.listTools().map((t) => t.name).join(', '));

  console.log('\nCalling web.search("actualités Dubaï")...');
  const result = await mcpClient.callTool('web.search', {
    query: 'actualités Dubaï',
    topic: 'news',
    max_results: 3,
  }, { actor_id: 'test', actor_role: 'platform_admin', tenant_id: null });

  if (!result.ok) {
    console.error('web.search failed:', result.error);
    process.exit(1);
  }

  const results = result.data?.results || [];
  console.log('Results:', results.length);
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.title || '—'} | ${r.url || ''}`);
  });

  console.log('\n✓ MCP web-assist OK');
}

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
