/**
 * EVA feature flags — runtime ON/OFF. Cache 30s.
 * If DB fails → return false (safe default).
 */
const db = require('../db');

const CACHE_TTL_MS = 30 * 1000;
let cache = {};
let cacheExpiry = 0;

async function getFlag(key) {
  if (!key || typeof key !== 'string') return false;
  const now = Date.now();
  if (cache[key] !== undefined && now < cacheExpiry) return cache[key];
  try {
    const r = await db.query(
      'SELECT enabled FROM eva.feature_flags WHERE key = $1',
      [key.trim()]
    );
    const val = r.rows[0]?.enabled === true;
    cache[key] = val;
    return val;
  } catch (e) {
    if (/relation "eva\.feature_flags" does not exist/i.test(String(e.message))) return false;
    console.warn('[EVA featureFlag] getFlag failed:', e.message);
    return false;
  }
}

async function setFlag(key, enabled) {
  if (!key || typeof key !== 'string') return false;
  try {
    await db.query(
      `INSERT INTO eva.feature_flags (key, enabled, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET enabled = $2, updated_at = now()`,
      [key.trim(), !!enabled]
    );
    cache[key] = !!enabled;
    return true;
  } catch (e) {
    if (/relation "eva\.feature_flags" does not exist/i.test(String(e.message))) return false;
    console.warn('[EVA featureFlag] setFlag failed:', e.message);
    return false;
  }
}

async function getAllFlags() {
  const now = Date.now();
  if (now < cacheExpiry && Object.keys(cache).length > 0) return { ...cache };
  try {
    const r = await db.query('SELECT key, enabled FROM eva.feature_flags');
    cache = {};
    r.rows.forEach((row) => { cache[row.key] = row.enabled === true; });
    cacheExpiry = now + CACHE_TTL_MS;
    return { ...cache };
  } catch (e) {
    if (/relation "eva\.feature_flags" does not exist/i.test(String(e.message))) return {};
    return {};
  }
}

function invalidateCache() {
  cache = {};
  cacheExpiry = 0;
}

module.exports = { getFlag, setFlag, getAllFlags, invalidateCache };
