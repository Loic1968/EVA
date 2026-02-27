/**
 * EVA memory_items — eva.memory_items table.
 * Used for /remember, /correct, /forget commands (alongside eva.facts when EVA_STRUCTURED_MEMORY).
 */
const db = require('../db');

function slugify(s) {
  return (s || '').toString().toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200) || 'unnamed';
}

async function addMemoryItem(ownerId, kind, key, value) {
  const k = slugify(key);
  if (!k) return null;
  const priority = kind === 'correction' ? 1 : kind === 'preference' ? 2 : 3;
  try {
    const r = await db.query(
      `INSERT INTO eva.memory_items (owner_id, kind, key, value, priority, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (owner_id, key) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value, priority = EXCLUDED.priority, updated_at = now()
       RETURNING id`,
      [ownerId, kind, k, (value || '').trim().slice(0, 10000), priority]
    );
    return r.rows[0]?.id;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

async function deleteByKey(ownerId, key) {
  const k = slugify(key);
  if (!k) return false;
  try {
    const r = await db.query(
      'DELETE FROM eva.memory_items WHERE owner_id = $1 AND key = $2 RETURNING id',
      [ownerId, k]
    );
    return (r.rowCount || 0) > 0;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return false;
    throw e;
  }
}

async function listKeys(ownerId) {
  try {
    const r = await db.query(
      'SELECT key, kind, value FROM eva.memory_items WHERE owner_id = $1 ORDER BY priority ASC, updated_at DESC',
      [ownerId]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

async function getByKey(ownerId, key) {
  const k = slugify(key);
  if (!k) return null;
  try {
    const r = await db.query(
      'SELECT id, key, kind, value FROM eva.memory_items WHERE owner_id = $1 AND key = $2',
      [ownerId, k]
    );
    return r.rows[0] || null;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

async function getMemoryItems(ownerId, limit = 30) {
  try {
    const r = await db.query(
      'SELECT id, kind, key, value FROM eva.memory_items WHERE owner_id = $1 ORDER BY priority ASC, updated_at DESC LIMIT $2',
      [ownerId, Math.min(limit, 100)]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

module.exports = {
  addMemoryItem,
  deleteByKey,
  listKeys,
  getByKey,
  getMemoryItems,
  slugify,
};
