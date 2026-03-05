/**
 * Tenant authorization - validate tenant exists and actor has access
 * Deny-by-default: block if uncertain
 */
import { query } from './db.js';
/**
 * Check tenant exists. Supports both `tenants` and `white_label_tenants` tables
 * (platform uses both in different contexts).
 */
async function tenantExists(tenantId) {
    const id = parseInt(tenantId, 10);
    if (!Number.isFinite(id) || id < 1)
        return false;
    try {
        const [t1, t2] = await Promise.all([
            query('SELECT 1 FROM tenants WHERE id = $1 AND (is_active IS NULL OR is_active = true) LIMIT 1', [id]),
            query('SELECT 1 FROM white_label_tenants WHERE id = $1 AND (is_active IS NULL OR is_active = true) LIMIT 1', [id]),
        ]);
        return (t1.rows.length > 0 || t2.rows.length > 0);
    }
    catch {
        return false;
    }
}
/**
 * Check actor has membership/permission for tenant.
 * For platform-level roles, tenant_id can be null (platform admin sees all).
 * Otherwise: require tenant to exist and actor to have access.
 */
export async function authorizeTenant(actorId, actorRole, tenantId, platformLevelRoles) {
    if (platformLevelRoles.includes(actorRole)) {
        return { allowed: true };
    }
    if (!tenantId) {
        return { allowed: false, reason: 'tenant_id required for non-platform actor' };
    }
    const exists = await tenantExists(tenantId);
    if (!exists) {
        return { allowed: false, reason: 'tenant not found or inactive' };
    }
    try {
        const { rows } = await query(`SELECT 1 FROM users WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) LIMIT 1`, [actorId, tenantId]);
        if (rows.length > 0)
            return { allowed: true };
        return { allowed: false, reason: 'actor has no membership for tenant' };
    }
    catch {
        return { allowed: false, reason: 'tenant authorization check failed' };
    }
}
