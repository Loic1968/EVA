/**
 * subscription.scan_plans - detect duplicate plans, inconsistent IDs, wrong checkout links
 */
import { query } from '../../core/db.js';
export async function subscriptionScanPlans(_args, _ctx) {
    try {
        const plansRes = await query(`SELECT id, slug, name, module, price, stripe_price_id, checkout_url
       FROM subscription_plans
       ORDER BY module, slug`);
        const plans = plansRes.rows;
        const findings = [];
        const seen = new Map();
        for (const p of plans) {
            const key = `${p.module || 'global'}:${p.slug}`;
            const ids = seen.get(key) || [];
            ids.push(p.id);
            seen.set(key, ids);
        }
        for (const [key, ids] of seen) {
            if (ids.length > 1) {
                findings.push({
                    type: 'duplicate_slug_module',
                    detail: `Duplicate slug+module: ${key}, ids: ${ids.join(', ')}`,
                    severity: 'high',
                });
            }
        }
        const modules = ['global', 'risk-analysis', 'hali-leads', 'haliform'];
        for (const p of plans) {
            const mod = p.module || 'global';
            if (!modules.includes(mod)) {
                findings.push({
                    type: 'unknown_module',
                    detail: `Plan ${p.id} has unknown module: ${mod}`,
                    severity: 'medium',
                });
            }
            if (p.checkout_url && !p.checkout_url.includes('stripe.com') && !p.checkout_url.includes('paypal')) {
                findings.push({
                    type: 'suspicious_checkout',
                    detail: `Plan ${p.id} checkout_url may be wrong: ${String(p.checkout_url).slice(0, 80)}`,
                    severity: 'medium',
                });
            }
        }
        return {
            ok: true,
            data: {
                planCount: plans.length,
                findings,
                summary: findings.length === 0 ? 'No issues detected' : `${findings.length} finding(s)`,
            },
        };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
