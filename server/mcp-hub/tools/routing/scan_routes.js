/**
 * routing.scan_routes - parse router files and output route map
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig } from '../../config/mcp.config.js';
async function readFileSafe(p) {
    try {
        return await fs.readFile(p, 'utf-8');
    }
    catch {
        return '';
    }
}
function extractRoutes(content) {
    const routes = [];
    const routeRe = /(?:path|Route)\s*[=:]\s*["']([^"']+)["']|path:\s*["']([^"']+)["']/g;
    const appUseRe = /app\.use\s*\(\s*["']([^"']+)["']/g;
    let m;
    while ((m = routeRe.exec(content)) !== null) {
        const p = m[1] || m[2];
        if (p)
            routes.push({ path: p, source: 'Route' });
    }
    while ((m = appUseRe.exec(content)) !== null) {
        if (m[1])
            routes.push({ path: m[1], source: 'app.use' });
    }
    return routes;
}
export async function routingScanRoutes(_args, _ctx) {
    const config = loadConfig();
    const root = path.resolve(config.projectRoot);
    const files = [
        path.join(root, 'src/AppRouter.js'),
        path.join(root, 'src/backend/routes/index.js'),
        path.join(root, 'src/backend/app.js'),
    ];
    const results = [];
    for (const f of files) {
        const content = await readFileSafe(f);
        if (!content)
            continue;
        const routes = extractRoutes(content);
        results.push({ file: path.relative(root, f), routes });
    }
    const allRoutes = results.flatMap((r) => r.routes.map((x) => ({ ...x, file: r.file })));
    return {
        ok: true,
        data: {
            files: results.map((r) => ({ file: r.file, count: r.routes.length })),
            routes: allRoutes,
            total: allRoutes.length,
        },
    };
}
