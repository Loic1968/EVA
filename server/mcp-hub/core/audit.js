/**
 * Immutable audit trail - append-only agent_audit_log
 * Stores args_hash (sha256) only, never raw args or secrets
 */
import { createHash } from 'crypto';
import { query } from './db.js';
function hashArgs(args) {
    const canonical = JSON.stringify(args, Object.keys(args || {}).sort());
    return createHash('sha256').update(canonical).digest('hex');
}
export async function writeAuditLog(entry) {
    const argsHash = hashArgs(entry.args);
    await query(`INSERT INTO agent_audit_log (
      actor_id, actor_role, tenant_id, tool_name, domain,
      risk_level, result_status, duration_ms, correlation_id,
      environment, args_hash, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`, [
        entry.actor_id,
        entry.actor_role,
        entry.tenant_id,
        entry.tool_name,
        entry.domain,
        entry.risk_level,
        entry.result_status,
        entry.duration_ms,
        entry.correlation_id,
        entry.environment,
        argsHash,
    ]);
}
export async function ensureAuditTable() {
    await query(`
    CREATE TABLE IF NOT EXISTS agent_audit_log (
      id SERIAL PRIMARY KEY,
      actor_id VARCHAR(255) NOT NULL,
      actor_role VARCHAR(100) NOT NULL,
      tenant_id VARCHAR(64),
      tool_name VARCHAR(128) NOT NULL,
      domain VARCHAR(64) NOT NULL,
      risk_level VARCHAR(32) NOT NULL,
      result_status VARCHAR(32) NOT NULL,
      duration_ms INTEGER NOT NULL,
      correlation_id VARCHAR(128) NOT NULL,
      environment VARCHAR(32) NOT NULL,
      args_hash VARCHAR(64) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}
