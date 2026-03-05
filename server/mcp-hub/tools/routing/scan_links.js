/**
 * routing.scan_links - scan Link/navigate/href/getTenantPath usage
 * Flag likely broken navigation
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig } from '../../config/mcp.config.js';
async function walkDir(dir, ext) {
    const out = [];
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
                out.push(...(await walkDir(full, ext)));
            }
            else if (e.isFile() && ext.some((x) => e.name.endsWith(x))) {
                out.push(full);
            }
        }
    }
    catch { }
    return out;
}
function scanContent(content, filePath) {
    const findings = [];
    const lines = content.split('\n');
    const patterns = [
        { re: /to=["']([^"']*)["']/, type: 'Link to' },
        { re: /navigate\s*\(\s*["']([^"']*)["']/, type: 'navigate' },
        { re: /href=["']([^"']*)["']/, type: 'href' },
        { re: /getTenantPath\s*\(\s*["']([^"']*)["']/, type: 'getTenantPath' },
    ];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { re, type } of patterns) {
            const m = line.match(re);
            if (m) {
                const target = m[1];
                const suspect = target.startsWith('http') || target.includes('..') || target.includes('//');
                if (suspect) {
                    findings.push({ type, line: `${i + 1}: ${line.trim()}`, match: target });
                }
            }
        }
    }
    return findings;
}
export async function routingScanLinks(_args, _ctx) {
    const config = loadConfig();
    const root = path.resolve(config.projectRoot);
    const srcDir = path.join(root, 'src');
    const files = await walkDir(srcDir, ['.js', '.jsx', '.ts', '.tsx']);
    const allFindings = [];
    for (const f of files) {
        const content = await fs.readFile(f, 'utf-8').catch(() => '');
        const findings = scanContent(content, f);
        if (findings.length > 0) {
            allFindings.push({ file: path.relative(root, f), findings });
        }
    }
    return {
        ok: true,
        data: {
            filesScanned: files.length,
            filesWithFindings: allFindings.length,
            findings: allFindings,
            summary: allFindings.length === 0 ? 'No suspicious links found' : `${allFindings.length} file(s) with potential issues`,
        },
    };
}
