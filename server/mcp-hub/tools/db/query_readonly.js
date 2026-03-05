/**
 * db.query_readonly - allow only SELECT or WITH; reject DML/DDL
 */
import { query } from '../../core/db.js';
const BLOCKED_KEYWORDS = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE',
    'CREATE', 'GRANT', 'REVOKE', 'EXECUTE', 'COPY', 'LOCK',
];
function validateSql(sql) {
    const upper = sql.toUpperCase().trim();
    if (upper.includes(';') && (upper.match(/;/g)?.length ?? 0) > 1) {
        return { ok: false, reason: 'Multi-statement not allowed' };
    }
    const single = sql.split(';')[0].trim().toUpperCase();
    const isSelect = single.startsWith('SELECT') || single.startsWith('WITH');
    if (!isSelect) {
        return { ok: false, reason: 'Only SELECT or WITH queries allowed' };
    }
    for (const kw of BLOCKED_KEYWORDS) {
        if (new RegExp(`\\b${kw}\\b`).test(single)) {
            return { ok: false, reason: `Blocked keyword: ${kw}` };
        }
    }
    return { ok: true };
}
export async function dbQueryReadonly(args, ctx) {
    const sql = args.sql;
    const tenantId = args.tenant_id;
    const params = args.params || [];
    if (!sql || typeof sql !== 'string') {
        return { ok: false, error: 'sql is required' };
    }
    const valid = validateSql(sql);
    if (!valid.ok) {
        return { ok: false, error: valid.reason };
    }
    const tid = tenantId ?? ctx.tenant_id;
    if (!tid) {
        return { ok: false, error: 'tenant_id required for db.query_readonly' };
    }
    try {
        await query('SET app.tenant_id = $1', [tid]);
        try {
            const result = await query(sql, params);
            return {
                ok: true,
                data: {
                    rowCount: result.rowCount,
                    rows: result.rows,
                },
            };
        }
        finally {
            await query('RESET app.tenant_id');
        }
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
