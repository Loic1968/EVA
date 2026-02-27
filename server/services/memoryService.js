/**
 * EVA memories — eva.memories table (legacy free-form).
 */
const db = require('../db');

async function addMemory(ownerId, fact, category = 'general') {
  try {
    const r = await db.query(
      `INSERT INTO eva.memories (owner_id, fact, category) VALUES ($1, $2, $3) RETURNING id`,
      [ownerId, (fact || '').trim().slice(0, 10000), category]
    );
    return r.rows[0]?.id;
  } catch (e) {
    if (/relation "eva\.memories" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

async function getMemories(ownerId, limit = 15) {
  try {
    const r = await db.query(
      'SELECT id, fact, category FROM eva.memories WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2',
      [ownerId, Math.min(limit, 50)]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.memories" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

module.exports = { addMemory, getMemories };
