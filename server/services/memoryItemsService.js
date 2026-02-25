/**
 * EVA Memory Items — structured learning (corrections > preferences > facts).
 * Injected into prompts so EVA applies corrections and remembers preferences.
 */
const db = require('../db');

const PRIORITY = { correction: 1, preference: 2, fact: 3 };

function slugify(text) {
  return (text || '').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, '_')
    .slice(0, 64)
    .replace(/_+$/, '') || 'general';
}

async function getMemoryItems(ownerId, limit = 40) {
  try {
    const r = await db.query(
      `SELECT id, kind, key, value, priority, updated_at
       FROM eva.memory_items
       WHERE owner_id = $1
       ORDER BY priority ASC, updated_at DESC
       LIMIT $2`,
      [ownerId, limit]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

async function addMemoryItem(ownerId, kind, key, value) {
  const k = (key || slugify(value)).trim().slice(0, 128);
  const v = (value || '').trim().slice(0, 2000);
  if (!k || !v) return null;
  const priority = PRIORITY[kind] ?? 3;
  try {
    const r = await db.query(
      `INSERT INTO eva.memory_items (owner_id, kind, key, value, priority)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_id, key) DO UPDATE SET value = $4, kind = $2, priority = $5, updated_at = now()
       RETURNING id`,
      [ownerId, kind, k, v, priority]
    );
    return r.rows[0]?.id;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

async function deleteByKey(ownerId, key) {
  const k = (key || '').trim().slice(0, 128);
  if (!k) return false;
  try {
    const r = await db.query(
      'DELETE FROM eva.memory_items WHERE owner_id = $1 AND key = $2 RETURNING id',
      [ownerId, k]
    );
    return r.rowCount > 0;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return false;
    throw e;
  }
}

async function listKeys(ownerId) {
  try {
    const r = await db.query(
      'SELECT kind, key FROM eva.memory_items WHERE owner_id = $1 ORDER BY priority ASC',
      [ownerId]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

async function getByKey(ownerId, key) {
  const k = (key || '').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 128);
  if (!k) return null;
  try {
    const r = await db.query(
      'SELECT kind, key, value FROM eva.memory_items WHERE owner_id = $1 AND key = $2 LIMIT 1',
      [ownerId, k]
    );
    return r.rows[0] || null;
  } catch (e) {
    if (/relation "eva\.memory_items" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

module.exports = { getMemoryItems, addMemoryItem, deleteByKey, listKeys, getByKey, slugify };
