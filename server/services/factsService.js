/**
 * EVA structured facts — eva.facts table.
 * Used when EVA_STRUCTURED_MEMORY=true.
 * Priority: 100 = user correction, 50 = remembered fact, 10 = extracted document.
 */
const db = require('../db');

const PRIORITY_CORRECTION = 100;
const PRIORITY_REMEMBER = 50;
const PRIORITY_DOCUMENT = 10;

async function upsertFact(ownerId, key, value, sourceType, sourceId, priority) {
  const k = (key || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!k) return null;
  const r = await db.query(
    `INSERT INTO eva.facts (owner_id, key, value, source_type, source_id, priority, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (owner_id, key) DO UPDATE SET
       value = EXCLUDED.value,
       source_type = EXCLUDED.source_type,
       source_id = EXCLUDED.source_id,
       priority = EXCLUDED.priority,
       updated_at = now()
     RETURNING id`,
    [ownerId, k, (value || '').trim().slice(0, 10000), sourceType || null, sourceId || null, priority ?? PRIORITY_DOCUMENT]
  );
  return r.rows[0]?.id;
}

async function upsertFactSafe(ownerId, key, value, sourceType, sourceId, priority) {
  try {
    return await upsertFact(ownerId, key, value, sourceType, sourceId, priority);
  } catch (e) {
    if (/relation "eva\.facts" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

async function addCorrection(ownerId, key, value) {
  return upsertFactSafe(ownerId, key, value, 'correction', null, PRIORITY_CORRECTION);
}

async function addRemember(ownerId, key, value) {
  return upsertFactSafe(ownerId, key, value, 'remember', null, PRIORITY_REMEMBER);
}

async function deleteFact(ownerId, key) {
  const k = (key || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!k) return false;
  try {
    const r = await db.query(
      'DELETE FROM eva.facts WHERE owner_id = $1 AND key = $2 RETURNING id',
      [ownerId, k]
    );
    return (r.rowCount || 0) > 0;
  } catch (e) {
    if (/relation "eva\.facts" does not exist/i.test(String(e.message))) return false;
    throw e;
  }
}

async function getFacts(ownerId, limit = 50) {
  try {
    const r = await db.query(
      `SELECT id, key, value, source_type, priority, updated_at
       FROM eva.facts
       WHERE owner_id = $1
       ORDER BY priority DESC, updated_at DESC
       LIMIT $2`,
      [ownerId, Math.min(limit, 100)]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.facts" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

async function getFactByKey(ownerId, key) {
  const k = (key || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!k) return null;
  try {
    const r = await db.query(
      'SELECT id, key, value, source_type, priority FROM eva.facts WHERE owner_id = $1 AND key = $2',
      [ownerId, k]
    );
    return r.rows[0] || null;
  } catch (e) {
    if (/relation "eva\.facts" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

/** Extract facts from document text and upsert to eva.facts. Returns count. */
const DATE_PATTERNS = [
  { re: /(?:date\s+de\s+naissance|date\s+of\s+birth|DOB|naissance)\s*[:=]\s*([^\n\r]+)/gi, key: 'date_of_birth' },
  { re: /(?:lieu\s+de\s+naissance|place\s+of\s+birth|birth\s+place)\s*[:=]\s*([^\n\r]+)/gi, key: 'place_of_birth' },
  { re: /(?:departure\s+date|date\s+de\s+d[eé]part|d[eé]part)\s*[:=]\s*([^\n\r]+)/gi, key: 'departure_date' },
  { re: /(?:full\s+name|nom\s+complet)\s*[:=]\s*([^\n\r]+)/gi, key: 'full_name' },
];

async function extractAndUpsertFromDocument(ownerId, documentId, text, opts = {}) {
  if (!text || !ownerId) return 0;
  let count = 0;
  const seen = new Set();
  for (const { re, key } of DATE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const val = (m[0].split(/[:=]\s*/)[1] || '').trim().slice(0, 200);
      if (val && !seen.has(key)) {
        await upsertFactSafe(ownerId, key, val, 'document', documentId, PRIORITY_DOCUMENT);
        seen.add(key);
        count++;
      }
    }
  }
  return count;
}

module.exports = {
  addCorrection,
  addRemember,
  deleteFact,
  getFacts,
  getFactByKey,
  upsertFactSafe,
  extractAndUpsertFromDocument,
};
