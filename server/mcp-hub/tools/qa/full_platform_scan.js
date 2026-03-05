/**
 * qa.full_platform_scan - orchestrates route+link+subscription scan
 */
import { routingScanRoutes } from '../routing/scan_routes.js';
import { routingScanLinks } from '../routing/scan_links.js';
import { subscriptionScanPlans } from '../subscription/scan_plans.js';
export async function qaFullPlatformScan(_args, ctx) {
    const [routes, links, plans] = await Promise.all([
        routingScanRoutes({}, ctx),
        routingScanLinks({}, ctx),
        subscriptionScanPlans({}, ctx),
    ]);
    const findings = [];
    if (routes.ok && routes.data) {
        const d = routes.data;
        if ((d.total ?? 0) === 0) {
            findings.push({ source: 'routing.scan_routes', severity: 'low', detail: 'No routes detected' });
        }
    }
    else {
        findings.push({ source: 'routing.scan_routes', severity: 'high', detail: routes.error || 'Scan failed' });
    }
    if (links.ok && links.data) {
        const d = links.data;
        if ((d.filesWithFindings ?? 0) > 0) {
            findings.push({
                source: 'routing.scan_links',
                severity: 'medium',
                detail: `${d.filesWithFindings} file(s) with potential navigation issues`,
            });
        }
    }
    else {
        findings.push({ source: 'routing.scan_links', severity: 'high', detail: links.error || 'Scan failed' });
    }
    if (plans.ok && plans.data) {
        const d = plans.data;
        const high = (d.findings || []).filter((f) => f.severity === 'high').length;
        const med = (d.findings || []).filter((f) => f.severity === 'medium').length;
        if (high > 0)
            findings.push({ source: 'subscription.scan_plans', severity: 'high', detail: `${high} high-severity finding(s)` });
        if (med > 0)
            findings.push({ source: 'subscription.scan_plans', severity: 'medium', detail: `${med} medium-severity finding(s)` });
    }
    else {
        findings.push({ source: 'subscription.scan_plans', severity: 'high', detail: plans.error || 'Scan failed' });
    }
    findings.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    });
    return {
        ok: true,
        data: {
            findings,
            prioritized: findings.slice(0, 10),
            summary: findings.length === 0 ? 'No issues found' : `${findings.length} finding(s) across scans`,
        },
    };
}
