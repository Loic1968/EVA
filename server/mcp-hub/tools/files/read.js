/**
 * files.read - allowlist roots, denylist patterns, no path traversal
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig } from '../../config/mcp.config.js';
const DENYLIST = [
    'node_modules',
    '.env',
    '.pem',
    '.key',
    'credentials',
    'secret',
    'password',
];
function isPathSafe(relPath, projectRoot) {
    const normalized = path.normalize(relPath);
    if (normalized.includes('..')) {
        return { ok: false, reason: 'Path traversal not allowed' };
    }
    const full = path.resolve(projectRoot, normalized);
    if (!full.startsWith(path.resolve(projectRoot))) {
        return { ok: false, reason: 'Path outside project root' };
    }
    const lower = normalized.toLowerCase();
    for (const d of DENYLIST) {
        if (lower.includes(d))
            return { ok: false, reason: `Denied pattern: ${d}` };
    }
    if (/\.env(\..*)?$/i.test(normalized))
        return { ok: false, reason: 'Denied: .env file' };
    if (/\.(pem|key)$/i.test(normalized))
        return { ok: false, reason: 'Denied: cert/key file' };
    return { ok: true };
}
function isInAllowlist(relPath, roots) {
    for (const r of roots) {
        if (relPath.startsWith(r) || relPath.startsWith('./' + r))
            return true;
    }
    return false;
}
export async function filesRead(args, _ctx) {
    const pathArg = args.path;
    if (!pathArg || typeof pathArg !== 'string') {
        return { ok: false, error: 'path is required' };
    }
    const config = loadConfig();
    const projectRoot = config.projectRoot;
    const safe = isPathSafe(pathArg.trim(), projectRoot);
    if (!safe.ok) {
        return { ok: false, error: safe.reason };
    }
    if (!isInAllowlist(pathArg.trim(), config.allowlistRoots)) {
        return { ok: false, error: `Path not in allowlist. Allowed roots: ${config.allowlistRoots.join(', ')}` };
    }
    try {
        const fullPath = path.resolve(projectRoot, path.normalize(pathArg.trim()));
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
            return { ok: true, data: { type: 'directory', path: pathArg, message: 'Use a file path to read content' } };
        }
        const content = await fs.readFile(fullPath, 'utf-8');
        return { ok: true, data: { path: pathArg, content: content.slice(0, 100_000) } };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
