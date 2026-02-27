/**
 * EVA feedback — eva.feedback table (thumbs down, corrections).
 * Used for context: "Éviter X → Utiliser Y".
 */
const db = require('../db');

async function getRecentFeedback(ownerId, limit = 10) {
  try {
    const r = await db.query(
      `SELECT feedback_type, original_text, corrected_text
       FROM eva.feedback
       WHERE owner_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [ownerId, Math.min(limit, 50)]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.feedback" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

module.exports = { getRecentFeedback };
