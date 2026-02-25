/**
 * EVA Memory Service — persistent facts EVA learns about the user.
 * Injected into chat/voice context so EVA remembers across sessions.
 */
const db = require('../db');

/**
 * Get all memories for an owner (most recent first, limit 50)
 */
async function getMemories(ownerId, limit = 50) {
  try {
    const r = await db.query(
      'SELECT id, fact, category, created_at FROM eva.memories WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2',
      [ownerId, limit]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.memories" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

/**
 * Add a memory. Dedupe: if similar fact exists (same first 50 chars), update instead of insert.
 */
async function addMemory(ownerId, fact, category = 'general') {
  const trimmed = (fact || '').trim().slice(0, 2000);
  if (!trimmed) return null;
  try {
    const existing = await db.query(
      `SELECT id FROM eva.memories WHERE owner_id = $1 AND fact LIKE $2 LIMIT 1`,
      [ownerId, trimmed.slice(0, 50) + '%']
    );
    if (existing.rows[0]) {
      await db.query(
        'UPDATE eva.memories SET fact = $1, category = $2 WHERE id = $3',
        [trimmed, category, existing.rows[0].id]
      );
      return existing.rows[0].id;
    }
    const r = await db.query(
      'INSERT INTO eva.memories (owner_id, fact, category) VALUES ($1, $2, $3) RETURNING id',
      [ownerId, trimmed, category]
    );
    return r.rows[0]?.id;
  } catch (e) {
    if (/relation "eva\.memories" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

/**
 * Delete a memory by id
 */
async function deleteMemory(ownerId, memoryId) {
  const r = await db.query('DELETE FROM eva.memories WHERE id = $1 AND owner_id = $2 RETURNING id', [memoryId, ownerId]);
  return r.rowCount > 0;
}

module.exports = { getMemories, addMemory, deleteMemory };
