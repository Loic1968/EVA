/**
 * EVA Feedback — read corrections so EVA learns from thumbs down/corrections.
 * Previously unused; now injected into prompts.
 */
const db = require('../db');

async function getRecentFeedback(ownerId, limit = 15) {
  try {
    const r = await db.query(
      `SELECT feedback_type, original_text, corrected_text, notes, created_at
       FROM eva.feedback
       WHERE owner_id = $1
         AND feedback_type IN ('correction', 'thumbs_down')
         AND (corrected_text IS NOT NULL OR original_text IS NOT NULL)
       ORDER BY created_at DESC
       LIMIT $2`,
      [ownerId, limit]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.feedback" does not exist/i.test(String(e.message))) return [];
    return [];
  }
}

module.exports = { getRecentFeedback };
