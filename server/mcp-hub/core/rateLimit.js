/**
 * Rate limiting - per actor and per tenant
 */
const actorCounts = new Map();
const tenantCounts = new Map();
const WINDOW_MS = 60_000;
export function checkRateLimit(actorId, tenantId, limitPerMinute) {
    const now = Date.now();
    function tick(map, key) {
        const cur = map.get(key);
        if (!cur) {
            map.set(key, { count: 1, resetAt: now + WINDOW_MS });
            return true;
        }
        if (now > cur.resetAt) {
            map.set(key, { count: 1, resetAt: now + WINDOW_MS });
            return true;
        }
        if (cur.count >= limitPerMinute)
            return false;
        cur.count++;
        return true;
    }
    if (!tick(actorCounts, actorId)) {
        return { allowed: false, reason: 'rate limit exceeded (actor)' };
    }
    if (tenantId && !tick(tenantCounts, `tenant:${tenantId}`)) {
        return { allowed: false, reason: 'rate limit exceeded (tenant)' };
    }
    return { allowed: true };
}
