/**
 * Tool Orchestration Layer — gives Claude direct tool access to EVA's services.
 *
 * Instead of pre-fetching context and injecting it into the system prompt,
 * Claude can now call gmail_search, calendar_search, doc_search on demand.
 * Web search is handled by MCP Hub (mcp_web_search, mcp_web_search_news).
 * Works across all modes: EVA standard, Assistant, Alice.
 *
 * Architecture:
 *   Claude request → tool_use block → executeOrchestatedTool() → EVA service → tool_result → Claude
 *   Loop up to MAX_TOOL_ROUNDS until Claude emits final text.
 */

const MAX_TOOL_ROUNDS = Number(process.env.EVA_MAX_TOOL_ROUNDS) || 6;
const TOOL_TIMEOUT_MS = Number(process.env.EVA_TOOL_TIMEOUT_MS) || 15000;

// ---------------------------------------------------------------------------
// Tool schemas — these are sent to Claude alongside CALENDAR_TOOLS
// ---------------------------------------------------------------------------

const ORCHESTRATOR_TOOLS = [
  {
    name: 'web_search',
    description:
      'Search the web for real-time information. Use this tool PROACTIVELY whenever the user asks about: ' +
      'current events, news, weather, prices, flights, sports scores, stock prices, ' +
      '"quoi de neuf", "what\'s happening", any question requiring up-to-date info, ' +
      'or ANY topic where your training data might be outdated. ' +
      'Also use when user says "cherche sur internet", "google ça", "regarde en ligne". ' +
      'Returns web results with titles, URLs, and content snippets. ALWAYS cite sources.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query in the best language for results (usually English for global topics). E.g. "Shanghai news today", "Dubai weather", "flights Paris Tokyo March 2026"' },
        topic: { type: 'string', description: 'news (for current events/actualités) or general (weather, prices, flights, etc.). Default: general' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_search',
    description:
      'Search the user\'s synced Gmail (inbox, sent, all). Use for: "do I have emails from X", "urgent messages", ' +
      '"emails about Y this week", "did Pierre write back?", "mon dernier email de…". Returns subject, from, date, preview.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms (name, subject, keyword). E.g. "Morgan urgent", "invoice factoring"' },
        folder: { type: 'string', description: 'inbox | sent | all. Default: all' },
        limit: { type: 'number', description: 'Max results (1-15). Default: 8' },
      },
      required: ['query'],
    },
  },
  {
    name: 'calendar_search',
    description:
      'Search the user\'s Google Calendar for events: meetings, flights, appointments. ' +
      'Use for: "what\'s on my calendar", "do I have a meeting tomorrow", "my flight to Shanghai", "agenda de la semaine".',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms (event title, location, person). E.g. "Shanghai", "meeting Pierre"' },
        days_back: { type: 'number', description: 'How many days in the past to search. Default: 7' },
        days_ahead: { type: 'number', description: 'How many days ahead to search. Default: 30' },
        limit: { type: 'number', description: 'Max results (1-20). Default: 10' },
      },
      required: ['query'],
    },
  },
  {
    name: 'doc_search',
    description:
      'Search the user\'s uploaded documents (PDFs, contracts, invoices, tickets, CVs, memos). ' +
      'Use for: "what does my contract say about X", "find the term sheet", "résume mon CV", "info from the investor report".',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query across document content. E.g. "revenue Q4", "clause indemnité"' },
        limit: { type: 'number', description: 'Max document chunks to return (1-10). Default: 5' },
      },
      required: ['query'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution — calls the existing EVA services
// ---------------------------------------------------------------------------

/**
 * Execute an orchestrator tool. Returns compact { ok, data, error, source }.
 * Fails closed: errors return a controlled result, never throw.
 */
async function executeOrchestratorTool(toolName, input, ownerId) {
  const start = Date.now();
  try {
    const result = await Promise.race([
      _dispatchTool(toolName, input, ownerId),
      _timeout(TOOL_TIMEOUT_MS, toolName),
    ]);
    return { ...result, _ms: Date.now() - start };
  } catch (err) {
    console.warn(`[toolOrchestrator] ${toolName} failed:`, err.message);
    return {
      ok: false,
      error: `Tool ${toolName} failed: ${err.message}`,
      source: toolName,
      _ms: Date.now() - start,
    };
  }
}

async function _dispatchTool(toolName, input, ownerId) {
  // Try MCP first if connected, fallback to direct service call
  if (mcpClient.isConnected()) {
    const mcpResult = await _dispatchViaMcp(toolName, input, ownerId);
    if (mcpResult) return mcpResult;
  }
  switch (toolName) {
    case 'web_search':
      return _execWebSearch(input);
    case 'gmail_search':
      return _execGmailSearch(input, ownerId);
    case 'calendar_search':
      return _execCalendarSearch(input, ownerId);
    case 'doc_search':
      return _execDocSearch(input, ownerId);
    default:
      return { ok: false, error: `Unknown orchestrator tool: ${toolName}`, source: toolName };
  }
}

/** Route orchestrator tools to their MCP equivalents */
async function _dispatchViaMcp(toolName, input, ownerId) {
  try {
    switch (toolName) {
      case 'web_search': {
        const topic = input.topic || 'general';
        const mcpTool = topic === 'news' ? 'web.search_news' : 'web.search';
        const result = await mcpClient.callTool(mcpTool, {
          query: input.query, max_results: 5, topic,
          time_range: topic === 'news' ? 'day' : undefined,
        });
        if (!result.ok) return null;
        let results = result.data?.results || [];
        // Fallback: if news results are irrelevant (global news for a local query), retry with general
        if (topic === 'news' && results.length > 0) {
          const qLower = (input.query || '').toLowerCase();
          const relevant = results.some(r => {
            const text = ((r.title || '') + ' ' + (r.content || '')).toLowerCase();
            return qLower.split(/\s+/).filter(w => w.length > 3).some(w => text.includes(w));
          });
          if (!relevant) {
            const r2 = await mcpClient.callTool('web.search', { query: input.query, max_results: 5 });
            if (r2.ok && r2.data?.results?.length > 0) results = r2.data.results;
          }
        }
        return {
          ok: true,
          data: results.map(r => ({
            title: r.title || '', url: r.url || '',
            content: (r.content || '').slice(0, 2000),
          })),
          source: 'web_search (mcp)',
        };
      }
      case 'gmail_search': {
        const result = await mcpClient.callTool('gmail.search', {
          owner_id: ownerId, query: input.query, limit: input.limit || 8, folder: input.folder || 'all',
        });
        if (!result.ok) return null; // fallback to direct
        const emails = (result.data?.emails || []).map(e => ({
          id: e.id, thread_id: e.thread_id,
          from: e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email,
          to: e.to_emails, subject: e.subject,
          date: e.received_at ? new Date(e.received_at).toISOString().slice(0, 10) : null,
          preview: (e.body_preview || e.snippet || '').slice(0, 800),
          is_read: e.is_read, has_attachments: e.has_attachments,
        }));
        return { ok: true, data: emails, source: 'gmail_search (mcp)' };
      }
      case 'calendar_search': {
        const result = await mcpClient.callTool('calendar.search', {
          owner_id: ownerId, query: input.query,
          days_before: input.days_back || 7, days_after: input.days_ahead || 30, limit: input.limit || 10,
        });
        if (!result.ok) return null;
        const events = (result.data?.events || []).map(ev => ({
          id: ev.id, title: ev.title, start: ev.start_at, end: ev.end_at,
          location: ev.location || null, all_day: ev.is_all_day || false,
        }));
        return { ok: true, data: events, source: 'calendar_search (mcp)' };
      }
      case 'doc_search': {
        const result = await mcpClient.callTool('docs.search', {
          owner_id: ownerId, query: input.query, limit: input.limit || 5,
        });
        if (!result.ok) return null;
        return { ok: true, data: result.data, source: 'doc_search (mcp)' };
      }
      default:
        return null;
    }
  } catch (e) {
    console.warn(`[toolOrchestrator] MCP dispatch for ${toolName} failed, falling back:`, e.message);
    return null;
  }
}

function _timeout(ms, toolName) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${toolName} timed out after ${ms}ms`)), ms)
  );
}

// -- Web search (direct Tavily/DuckDuckGo fallback when MCP not connected) --
async function _execWebSearch(input) {
  try {
    const ws = require('./webSearchService');
    if (!ws.isAvailable()) {
      // Try DuckDuckGo via MCP hub tools (they have DDG fallback built-in)
      return { ok: false, error: 'Web search not available (no TAVILY_API_KEY). Configure it in Settings.', source: 'web_search' };
    }
    const topic = input.topic || 'general';
    const data = await ws.search(input.query, {
      maxResults: 5,
      topic,
      timeRange: topic === 'news' ? 'day' : null,
    });
    let results = data?.results || [];
    // Same news→general fallback as MCP path
    if (topic === 'news' && results.length > 0) {
      const qLower = (input.query || '').toLowerCase();
      const relevant = results.some(r => {
        const text = ((r.title || '') + ' ' + (r.content || '')).toLowerCase();
        return qLower.split(/\s+/).filter(w => w.length > 3).some(w => text.includes(w));
      });
      if (!relevant) {
        const data2 = await ws.search(input.query, { maxResults: 5, topic: 'general' });
        if (data2?.results?.length > 0) results = data2.results;
      }
    }
    return {
      ok: true,
      data: results.map(r => ({
        title: r.title || '', url: r.url || '',
        content: (r.content || '').slice(0, 2000),
      })),
      source: 'web_search (tavily)',
    };
  } catch (err) {
    return { ok: false, error: `Web search failed: ${err.message}`, source: 'web_search' };
  }
}

// -- Gmail search --
async function _execGmailSearch(input, ownerId) {
  if (!ownerId) return { ok: false, error: 'Not authenticated — no owner ID', source: 'gmail_search' };
  const gmailSync = require('./gmailSync');
  const folder = input.folder || 'all';
  const limit = Math.min(input.limit || 8, 15);
  const emails = await gmailSync.searchEmails(ownerId, input.query, limit, null, folder);
  const data = emails.map((e) => ({
    id: e.id,
    thread_id: e.thread_id,
    from: e.from_name ? `${e.from_name} <${e.from_email}>` : e.from_email,
    to: e.to_emails,
    subject: e.subject,
    date: e.received_at ? new Date(e.received_at).toISOString().slice(0, 10) : null,
    preview: (e.body_preview || e.snippet || '').slice(0, 800),
    is_read: e.is_read,
    has_attachments: e.has_attachments,
  }));
  return { ok: true, data, source: 'gmail_search' };
}

// -- Calendar search --
async function _execCalendarSearch(input, ownerId) {
  if (!ownerId) return { ok: false, error: 'Not authenticated — no owner ID', source: 'calendar_search' };
  const calendarSync = require('./calendarSync');
  const daysBack = Math.min(input.days_back || 7, 90);
  const daysAhead = Math.min(input.days_ahead || 30, 180);
  const limit = Math.min(input.limit || 10, 20);
  const events = await calendarSync.searchCalendarEvents(ownerId, input.query, daysBack, daysAhead, limit);
  const data = (events || []).map((ev) => ({
    id: ev.id,
    title: ev.title,
    start: ev.start_at,
    end: ev.end_at,
    location: ev.location || null,
    all_day: ev.is_all_day || false,
  }));
  return { ok: true, data, source: 'calendar_search' };
}

// -- Document search --
async function _execDocSearch(input, ownerId) {
  if (!ownerId) return { ok: false, error: 'Not authenticated — no owner ID', source: 'doc_search' };
  const docProcessor = require('./documentProcessor');
  const limit = Math.min(input.limit || 5, 10);
  let docs = [];
  if (docProcessor.searchDocumentsWithCitations) {
    docs = await docProcessor.searchDocumentsWithCitations(ownerId, input.query, limit);
  } else {
    docs = await docProcessor.searchDocuments(ownerId, input.query, limit);
  }
  if (docs.length === 0) {
    // Fallback: recent documents
    const recent = await docProcessor.getRecentDocuments(ownerId, limit);
    docs = recent.map((d) => ({ ...d, citation: { filename: d.filename, chunk_index: 0 } }));
  }
  const data = docs.map((d) => ({
    filename: d.filename,
    section: d.citation ? (d.citation.chunk_index ?? 0) + 1 : 1,
    content: (d.content_text || d.content_preview || '').slice(0, 4000),
  }));
  return { ok: true, data, source: 'doc_search' };
}

// ---------------------------------------------------------------------------
// Orchestrator tool names — used to distinguish from existing CALENDAR_TOOLS
// ---------------------------------------------------------------------------

const ORCHESTRATOR_TOOL_NAMES = new Set(ORCHESTRATOR_TOOLS.map((t) => t.name));

function isOrchestratorTool(name) {
  return ORCHESTRATOR_TOOL_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// MCP Integration — connects to mcp-hub for platform-level tools
// ---------------------------------------------------------------------------

const mcpClient = require('./mcpClient');

/** Check if a tool name is an MCP tool (prefixed with mcp_) */
function isMcpTool(name) {
  return name.startsWith('mcp_');
}

/**
 * Execute an MCP tool via the mcp-hub.
 * Strips the 'mcp_' prefix and converts underscores back to dots.
 * Returns { ok, data, error, source, _ms } matching orchestrator format.
 */
async function executeMcpTool(toolName, input, ownerId) {
  const start = Date.now();
  try {
    // Convert mcp_db_query_readonly → db.query_readonly
    const mcpName = toolName.replace(/^mcp_/, '').replace(/_/, '.').replace(/_/g, '_');
    // Actually: mcp-hub uses domain.name format like "db.query_readonly"
    // Our naming: mcp_db_query_readonly → need first underscore to be a dot
    const parts = toolName.replace(/^mcp_/, '').split('_');
    const domain = parts[0];
    const name = parts.slice(1).join('_');
    const fullName = `${domain}.${name}`;

    const result = await mcpClient.callTool(fullName, input, {
      actor_id: ownerId || 'eva-assistant',
      actor_role: 'platform_admin',
      tenant_id: null,
    });
    return { ...result, _ms: Date.now() - start };
  } catch (err) {
    console.warn(`[toolOrchestrator] MCP ${toolName} failed:`, err.message);
    return {
      ok: false,
      error: `MCP tool ${toolName} failed: ${err.message}`,
      source: toolName,
      _ms: Date.now() - start,
    };
  }
}

/**
 * Check if MCP is enabled (env override > DB flag > default true).
 */
async function isMcpEnabled() {
  // Env var: explicit enable overrides DB
  if (process.env.EVA_MCP_ENABLED === 'true') return true;
  // Env var: hard kill
  if (process.env.EVA_MCP_ENABLED === 'false') return false;
  // DB feature flag (toggle from Settings UI)
  try {
    const featureFlagService = require('./featureFlagService');
    const flag = await featureFlagService.getFlag('mcp_enabled');
    // If flag exists in DB, respect it. If not in DB yet, default to true.
    return flag !== false;
  } catch {
    return true; // DB not available yet — default enabled
  }
}

/**
 * Initialize MCP connection. Called at server startup.
 * Non-blocking: if MCP hub is unavailable, EVA continues without it.
 */
async function initMcp() {
  const enabled = await isMcpEnabled();
  if (!enabled) {
    console.log('[toolOrchestrator] MCP disabled (env or feature flag)');
    return false;
  }
  try {
    const ok = await mcpClient.connect();
    if (ok) {
      const tools = mcpClient.listTools();
      console.log(`[toolOrchestrator] MCP connected — ${tools.length} tools available`);
    }
    return ok;
  } catch (err) {
    console.warn('[toolOrchestrator] MCP init failed (EVA continues without it):', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Build combined tool list for Claude
// ---------------------------------------------------------------------------

/**
 * Returns all tools Claude should have:
 *   existing CALENDAR_TOOLS + orchestrator tools + MCP tools.
 * @param {Array} existingTools - The CALENDAR_TOOLS array from evaChat.js
 * @returns {Array} Combined tool schemas
 */
function buildAllTools(existingTools = []) {
  // Orchestrator can be disabled via env var (safe default: enabled)
  const orchestratorTools = process.env.EVA_ORCHESTRATOR_TOOLS === 'false' ? [] : ORCHESTRATOR_TOOLS;

  // MCP tools (available only if connected — flag checked at connect time)
  let mcpTools = [];
  if (mcpClient.isConnected()) {
    mcpTools = mcpClient.buildMcpToolSchemas();
  }

  return [...existingTools, ...orchestratorTools, ...mcpTools];
}

// ---------------------------------------------------------------------------
// Structured trace for debugging
// ---------------------------------------------------------------------------

function createTrace(mode) {
  return {
    mode: mode || 'eva_standard',
    toolCalls: [],
    iterations: 0,
  };
}

function traceToolCall(trace, name, ms, ok) {
  trace.toolCalls.push({ name, ms, ok });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ORCHESTRATOR_TOOLS,
  ORCHESTRATOR_TOOL_NAMES,
  isOrchestratorTool,
  executeOrchestratorTool,
  isMcpTool,
  executeMcpTool,
  initMcp,
  buildAllTools,
  createTrace,
  traceToolCall,
  MAX_TOOL_ROUNDS,
};
