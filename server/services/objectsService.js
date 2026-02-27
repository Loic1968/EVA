/**
 * EVA objects — matter tracking (insurance, travel, visa, etc.)
 * Used when EVA_ASSISTANT_MODE / EVA_STRUCTURED_MEMORY.
 */
const db = require('../db');

async function getActiveObjects(ownerId, limit = 10) {
  try {
    const r = await db.query(
      `SELECT id, object_type, name, status, metadata, updated_at
       FROM eva.objects
       WHERE owner_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [ownerId, Math.min(limit, 50)]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.objects" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

async function upsertObject(ownerId, objectType, name, status, metadata = {}) {
  try {
    const r = await db.query(
      `INSERT INTO eva.objects (owner_id, object_type, name, status, metadata, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [ownerId, objectType, name || objectType, status || 'active', JSON.stringify(metadata)]
    );
    return r.rows[0]?.id;
  } catch (e) {
    if (/relation "eva\.objects" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

async function getByType(ownerId, objectType) {
  try {
    const r = await db.query(
      'SELECT id, name, status, metadata, updated_at FROM eva.objects WHERE owner_id = $1 AND object_type = $2 ORDER BY updated_at DESC LIMIT 1',
      [ownerId, objectType]
    );
    return r.rows[0] || null;
  } catch (e) {
    if (/relation "eva\.objects" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

module.exports = { getActiveObjects, upsertObject, getByType };
