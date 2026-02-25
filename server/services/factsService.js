/**
 * EVA Facts Service — structured key-value memory from documents and corrections.
 * Gated by EVA_STRUCTURED_MEMORY=true.
 * Priority: correction=100 > remember=50 > document=10. Higher overrides lower.
 * Uses Claude for fact extraction (no regex fallback).
 */
const db = require('../db');

const PRIORITY = { correction: 100, remember: 50, document: 10, system: 5 };
const DOCUMENT_PRIORITY = 10;

const FACT_EXTRACTION_SYSTEM = `You extract structured facts from documents with maximum precision. Rules:
1. EXACT transcription: Copy values character-for-character. "15 mars 1985" not "15/03/1985". "2 mars" not "02/03". Preserve slashes, dots, spaces as written.
2. Distinguish fields: flight_departure_date ≠ flight_arrival_date. document_expiry_date ≠ visa_expiry_date. Use separate keys.
3. No inference: Only extract what is clearly legible. If ambiguous, omit.
4. No normalization: Do not convert dates, amounts, or names. Output exactly as printed.
5. Keys: snake_case, descriptive. date_of_birth, passport_number, flight_departure_date, flight_arrival_date, flight_departure_time, flight_arrival_time, route, invoice_due_date, invoice_number, supplier_name, total_amount, etc.
6. Omit null/empty. Output only facts you are certain about.`;

function buildFactExtractionPrompt(text, filename = '', docType = '') {
  let ctx = '';
  if (filename) ctx += `\nFilename: ${filename}`;
  if (docType) ctx += `\nDocument type: ${docType}`;
  return `${FACT_EXTRACTION_SYSTEM}
${ctx}

Extract all structured facts from the document below. Output ONLY valid JSON. No markdown, no explanation.
Keys: snake_case. Values: exact strings as printed. One JSON object.`;
}

const REJECT_VALUES = /^(n\/?a|unknown|—|–|-|none|\.{3}|\.\.\.)$/i;

async function extractFactsViaAI(text, options = {}) {
  const { filename = '', docType = '' } = options;
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key || !text || typeof text !== 'string') return [];
  const trimmed = text.trim().slice(0, 50000);
  if (trimmed.length < 10) return [];
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key.trim() });
    const prompt = buildFactExtractionPrompt(trimmed, filename, docType);
    const response = await client.messages.create({
      model: process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: `${prompt}\n\n--- DOCUMENT ---\n${trimmed}\n--- END ---` }],
    });
    const textBlock = response.content?.find((b) => b.type === 'text');
    const raw = (textBlock?.text || '').trim();
    if (!raw) return [];
    const jsonStr = raw.replace(/^```json?\s*|\s*```$/g, '').trim();
    const obj = JSON.parse(jsonStr);
    const facts = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v != null && typeof v === 'string') {
        const value = v.trim().slice(0, 2000);
        const keyNormalized = k.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        if (value.length >= 2 && keyNormalized.length >= 2 && !REJECT_VALUES.test(value) && !/^[\s\-\.]+$/.test(value)) {
          facts.push({ key: keyNormalized, value });
        }
      }
    }
    return facts;
  } catch (e) {
    if (process.env.EVA_DEBUG === 'true') {
      console.warn('[FactsService] AI extraction failed:', e.message);
    }
    return [];
  }
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

async function extractAndUpsertFromDocument(ownerId, documentId, text, options = {}) {
  if (!process.env.EVA_STRUCTURED_MEMORY || process.env.EVA_STRUCTURED_MEMORY !== 'true') return 0;
  const facts = await extractFactsViaAI(text, options);
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
  extractFactsViaAI,
  upsertFactSafe,
  getFacts,
  getFactByKey,
  deleteFact,
  extractAndUpsertFromDocument,
  addCorrection,
  addRemember,
  PRIORITY,
};
