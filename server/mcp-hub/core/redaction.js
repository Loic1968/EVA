/**
 * Output redaction - never leak secrets, tokens, keys
 */
const REDACT_PATTERNS = [
    /\b(?:password|passwd|pwd|secret|api[_-]?key|apikey|auth[_-]?token|token|bearer|credential)\s*[:=]\s*["']?[^\s"']+["']?/gi,
    /\b(?:sk-[a-zA-Z0-9]{20,})/g,
    /\b(?:pk_[a-zA-Z0-9]{20,})/g,
    /\b[A-Za-z0-9_-]{32,}\s*(?:==)?\s*$/g,
    /Bearer\s+[A-Za-z0-9_-]+/gi,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    /["']?[A-Z_]+["']?\s*[:=]\s*["'][^"']+["']/g,
];
const REDACT_REPLACEMENT = '[REDACTED]';
export function redact(text) {
    if (typeof text !== 'string')
        return text;
    let out = text;
    for (const re of REDACT_PATTERNS) {
        out = out.replace(re, REDACT_REPLACEMENT);
    }
    return out;
}
export function redactObject(obj) {
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj === 'string')
        return redact(obj);
    if (Array.isArray(obj))
        return obj.map(redactObject);
    if (typeof obj === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            const lower = k.toLowerCase();
            if (lower.includes('password') ||
                lower.includes('secret') ||
                lower.includes('token') ||
                lower.includes('key') ||
                lower.includes('credential')) {
                out[k] = '[REDACTED]';
            }
            else {
                out[k] = redactObject(v);
            }
        }
        return out;
    }
    return obj;
}
