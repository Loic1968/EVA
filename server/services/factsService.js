/**
 * EVA Facts Service — structured key-value memory from documents and corrections.
 * Gated by EVA_STRUCTURED_MEMORY=true.
 * Priority: correction=100 > remember=50 > document=10. Higher overrides lower.
 */
const db = require('../db');

const PRIORITY = { correction: 100, remember: 50, document: 10, system: 5 };
const DOCUMENT_PRIORITY = 10;

// Regex patterns for document fact extraction (simple, no OCR heavy logic)
const PATTERNS = [
  // --- IDENTITY DOCUMENT --- block (Claude output)
  {
    key: 'date_of_birth',
    regex: /(?:Date\s+of\s+birth|Date\s+de\s+naissance)[:\s]+([^\n]+)/i,
    clean: (v) => v.trim().slice(0, 64),
  },
  {
    key: 'passport_number',
    regex: /(?:Document\s+number|Num[eé]ro|Passport\s*(?:no\.?|number)?)[:\s]+([A-Z0-9]{6,20})/i,
    clean: (v) => v.trim().slice(0, 32),
  },
  {
    key: 'nationality',
    regex: /(?:Nationality|Nationalit[eé])[:\s]+([^\n]+)/i,
    clean: (v) => v.trim().slice(0, 64),
  },
  {
    key: 'visa_expiry_date',
    regex: /(?:Expiry\s+date|Date\s+d['']expiration|Visa\s+expir)[:\s]+([^\n]+)/i,
    clean: (v) => v.trim().slice(0, 64),
  },
  // --- FLIGHT DATES --- block
  {
    key: 'next_flight_shanghai',
    regex: /(?:Route[:\s]+.*?PVG|PVG|Shanghai).*?(?:Departure\s+date|Arrival\s+date)[:\s]+([^\n]+)/is,
    clean: (v) => v.trim().slice(0, 64),
  },
  {
    key: 'flight_departure_date',
    regex: /Departure\s+date[:\s]+([^\n]+)/i,
    clean: (v) => v.trim().slice(0, 64),
  },
  {
    key: 'flight_arrival_date',
    regex: /Arrival\s+date[:\s]+([^\n]+)/i,
    clean: (v) => v.trim().slice(0, 64),
  },
  // --- DOCUMENT KEY DATA --- (invoice due date)
  {
    key: 'invoice_due_date',
    regex: /(?:Due\s+date|Date\s+[eé]ch[eé]ance|Date\s+d[''][eé]ch[eé]ance)[:\s]+([^\n]+)/i,
    clean: (v) => v.trim().slice(0, 64),
  },
  // Fallback: date de naissance anywhere
  {
    key: 'date_of_birth',
    regex: /(?:date\s+de\s+naissance|birth\s*date)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}\s+(?:janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+\d{2,4})/i,
    clean: (v) => v.trim().slice(0, 64),
  },
];

function extractFactsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const facts = [];
  const seen = new Set();
  for (const { key, regex, clean } of PATTERNS) {
    const m = text.match(regex);
    if (m && m[1]) {
      const value = clean(m[1]);
      if (value && value.length >= 2 && !seen.has(key)) {
        seen.add(key);
        facts.push({ key, value });
      }
    }
  }
  return facts;
}

async function upsertFactSafe(ownerId, key, value, sourceType, sourceId, priority) {
  const k = (key || '').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 128);
  const v = (value || '').trim().slice(0, 2000);
  if (!k || !v) return null;
  try {
    const existing = await db.query(
      'SELECT id, priority FROM eva.facts WHERE owner_id = $1 AND key = $2 LIMIT 1',
      [ownerId, k]
    );
    if (existing.rows[0]) {
      const currPriority = existing.rows[0].priority;
      if (priority <= currPriority) return existing.rows[0].id; // Don't override higher-priority
      await db.query(
        'UPDATE eva.facts SET value = $1, source_type = $2, source_id = $3, priority = $4, updated_at = now() WHERE id = $5',
        [v, sourceType, sourceId, priority, existing.rows[0].id]
      );
      return existing.rows[0].id;
    }
    const r = await db.query(
      `INSERT INTO eva.facts (owner_id, key, value, source_type, source_id, confidence, priority)
       VALUES ($1, $2, $3, $4, $5, 0.8, $6) RETURNING id`,
      [ownerId, k, v, sourceType, sourceId, priority]
    );
    return r.rows[0]?.id;
  } catch (e) {
    if (/relation "eva\.facts" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

async function getFacts(ownerId, limit = 50) {
  try {
    const r = await db.query(
      `SELECT id, key, value, source_type, source_id, confidence, priority, updated_at
       FROM eva.facts
       WHERE owner_id = $1
       ORDER BY priority DESC, updated_at DESC
       LIMIT $2`,
      [ownerId, limit]
    );
    return r.rows;
  } catch (e) {
    if (/relation "eva\.facts" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

async function getFactByKey(ownerId, key) {
  const k = (key || '').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 128);
  if (!k) return null;
  try {
    const r = await db.query(
      'SELECT id, key, value, confidence, priority FROM eva.facts WHERE owner_id = $1 AND key = $2 LIMIT 1',
      [ownerId, k]
    );
    return r.rows[0] || null;
  } catch (e) {
    if (/relation "eva\.facts" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

async function deleteFact(ownerId, key) {
  const k = (key || '').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 128);
  if (!k) return false;
  try {
    const r = await db.query('DELETE FROM eva.facts WHERE owner_id = $1 AND key = $2 RETURNING id', [ownerId, k]);
    return r.rowCount > 0;
  } catch (e) {
    if (/relation "eva\.facts" does not exist/i.test(String(e.message))) return false;
    throw e;
  }
}

async function extractAndUpsertFromDocument(ownerId, documentId, text) {
  if (!process.env.EVA_STRUCTURED_MEMORY || process.env.EVA_STRUCTURED_MEMORY !== 'true') return 0;
  const facts = extractFactsFromText(text);
  let count = 0;
  for (const { key, value } of facts) {
    const id = await upsertFactSafe(ownerId, key, value, 'document', documentId, DOCUMENT_PRIORITY);
    if (id) count++;
  }
  return count;
}

async function addCorrection(ownerId, key, value) {
  return upsertFactSafe(ownerId, key, value, 'correction', null, PRIORITY.correction);
}

async function addRemember(ownerId, key, value) {
  return upsertFactSafe(ownerId, key, value, 'conversation', null, PRIORITY.remember);
}

module.exports = {
  extractFactsFromText,
  upsertFactSafe,
  getFacts,
  getFactByKey,
  deleteFact,
  extractAndUpsertFromDocument,
  addCorrection,
  addRemember,
  PRIORITY,
};
