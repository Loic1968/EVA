/**
 * env.check_sanity - confirm required env var names exist (no values)
 */
const REQUIRED = [
    'DATABASE_URL',
    'JWT_SECRET',
    'NODE_ENV',
];
export async function envCheckSanity(_args, _ctx) {
    const present = [];
    const missing = [];
    for (const name of REQUIRED) {
        const v = process.env[name];
        if (typeof v === 'string' && v.trim().length > 0) {
            present.push(name);
        }
        else {
            missing.push(name);
        }
    }
    return {
        ok: true,
        data: {
            present,
            missing,
            summary: missing.length === 0 ? 'OK' : `Missing: ${missing.join(', ')}`,
        },
    };
}
