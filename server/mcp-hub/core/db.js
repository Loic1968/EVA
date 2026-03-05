/**
 * Database adapter - uses platform DB pool when available
 * Falls back to direct DATABASE_URL for standalone MCP Hub
 */
import pg from 'pg';
const { Pool } = pg;
let pool = null;
export function initDb() {
    if (pool)
        return pool;
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error('DATABASE_URL is required for MCP Hub DB access');
    }
    pool = new Pool({
        connectionString: url,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
    });
    return pool;
}
export function getDb() {
    return pool;
}
export async function query(text, params) {
    const p = pool || initDb();
    return p.query(text, params);
}
