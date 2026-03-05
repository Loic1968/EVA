/**
 * MCP Server - stdio transport, JSON-RPC 2.0
 * Compatible with Cursor/Claude MCP
 */
import * as readline from 'readline';
import { loadConfig } from '../config/mcp.config.js';
import { registerAllTools } from '../tools/index.js';
import { getTool } from './registry.js';
import { authorizeTenant } from './tenantAuth.js';
import { PLATFORM_LEVEL_ROLES } from './schemas.js';
import { checkToolPermission } from './permissions.js';
import { checkRateLimit } from './rateLimit.js';
import { withTimeout } from './timeout.js';
import { redactObject } from './redaction.js';
import { writeAuditLog } from './audit.js';
import { initDb, getDb } from './db.js';
import { ensureAuditTable } from './audit.js';
registerAllTools();
function getContext() {
    const config = loadConfig();
    return {
        actor_id: process.env.MCP_ACTOR_ID || 'system',
        actor_role: process.env.MCP_ACTOR_ROLE || 'platform_admin',
        tenant_id: process.env.MCP_TENANT_ID || null,
        correlation_id: process.env.MCP_CORRELATION_ID || `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        environment: config.environment,
    };
}
function parseContext(req) {
    const base = getContext();
    const ctx = req.params?.arguments?._context;
    if (ctx) {
        return {
            actor_id: ctx.actor_id ?? base.actor_id,
            actor_role: ctx.actor_role ?? base.actor_role,
            tenant_id: ctx.tenant_id ?? base.tenant_id,
            correlation_id: ctx.correlation_id ?? base.correlation_id,
            environment: base.environment,
        };
    }
    return base;
}
function stripContext(args) {
    const { _context, ...rest } = args;
    return rest;
}
async function handleToolsCall(params, reqId) {
    const name = params?.name;
    const rawArgs = (params?.arguments || {});
    const args = stripContext(rawArgs);
    const ctx = parseContext({ params });
    const config = loadConfig();
    const tool = getTool(name || '');
    if (!tool) {
        return {
            jsonrpc: '2.0',
            id: reqId,
            error: { code: -32601, message: `Unknown tool: ${name}` },
        };
    }
    const perm = checkToolPermission(tool.risk_level, tool.name);
    if (!perm.allowed) {
        return {
            jsonrpc: '2.0',
            id: reqId,
            error: { code: -32002, message: perm.reason || 'Permission denied' },
        };
    }
    const tenantAuth = await authorizeTenant(ctx.actor_id, ctx.actor_role, ctx.tenant_id, PLATFORM_LEVEL_ROLES);
    if (!tenantAuth.allowed) {
        return {
            jsonrpc: '2.0',
            id: reqId,
            error: { code: -32003, message: tenantAuth.reason || 'Tenant authorization denied' },
        };
    }
    const rateLimit = checkRateLimit(ctx.actor_id, ctx.tenant_id, config.rateLimitPerActorPerMinute);
    if (!rateLimit.allowed) {
        return {
            jsonrpc: '2.0',
            id: reqId,
            error: { code: -32004, message: rateLimit.reason || 'Rate limit exceeded' },
        };
    }
    const timeoutMs = tool.timeoutMs ?? config.defaultToolTimeoutMs;
    const start = Date.now();
    let resultStatus = 'ok';
    let result;
    try {
        result = await withTimeout(() => tool.handler(args, { ...ctx, environment: config.environment }), timeoutMs, `${tool.domain}.${tool.name}`);
    }
    catch (err) {
        resultStatus = 'error';
        result = { ok: false, error: err.message };
    }
    const durationMs = Date.now() - start;
    const redacted = redactObject(result);
    try {
        if (getDb()) {
            await writeAuditLog({
                actor_id: ctx.actor_id,
                actor_role: ctx.actor_role,
                tenant_id: ctx.tenant_id,
                tool_name: `${tool.domain}.${tool.name}`,
                domain: tool.domain,
                risk_level: tool.risk_level,
                result_status: resultStatus,
                duration_ms: durationMs,
                correlation_id: ctx.correlation_id,
                environment: config.environment,
                args,
            });
        }
    }
    catch (auditErr) {
        console.error('[MCP] Audit write failed:', auditErr.message);
    }
    const content = Array.isArray(redacted?.content)
        ? redacted.content
        : [{ type: 'text', text: JSON.stringify(redacted, null, 2) }];
    return {
        jsonrpc: '2.0',
        id: reqId,
        result: {
            content,
            isError: resultStatus === 'error',
        },
    };
}
async function handleToolsList(reqId) {
    const { listTools } = await import('./registry.js');
    const toolsList = listTools().map((t) => ({
        name: `${t.domain}.${t.name}`,
        description: `${t.domain} / ${t.name}`,
        inputSchema: {
            type: 'object',
            properties: t.schema || {},
        },
    }));
    return {
        jsonrpc: '2.0',
        id: reqId,
        result: { tools: toolsList },
    };
}
async function handleInitialize(reqId) {
    return {
        jsonrpc: '2.0',
        id: reqId,
        result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'halisoft-mcp-hub', version: '1.0.0' },
            capabilities: { tools: {} },
        },
    };
}
async function handleRequest(req) {
    const id = req.id ?? null;
    const method = req.method;
    if (method === 'initialize')
        return handleInitialize(id);
    if (method === 'tools/list')
        return handleToolsList(id);
    if (method === 'tools/call')
        return handleToolsCall(req.params, id);
    return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
    };
}
function main() {
    if (process.env.DATABASE_URL) {
        try {
            initDb();
        }
        catch (err) {
            console.error('[MCP] DB init failed:', err.message);
        }
        ensureAuditTable().catch(() => { });
    }
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
        try {
            const req = JSON.parse(line);
            handleRequest(req)
                .then((res) => {
                process.stdout.write(JSON.stringify(res) + '\n');
            })
                .catch((err) => {
                process.stdout.write(JSON.stringify({
                    jsonrpc: '2.0',
                    id: req.id,
                    error: { code: -32603, message: err.message },
                }) + '\n');
            });
        }
        catch {
            process.stdout.write(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' },
            }) + '\n');
        }
    });
}
main();
