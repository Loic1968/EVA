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

function inferDocTypeFromContent(text) {
  if (!text || text.length < 50) return '';
  const head = text.slice(0, 3000).toLowerCase();
  if (/---\s*identity\s*document\s*---|date\s+de\s+naissance|date\s+of\s+birth|passport|passeport|nationalit[eé]|document\s+number/i.test(head)) return 'id_document';
  if (/---\s*flight\s*dates\s*---|departure\s+date|arrival\s+date|boarding|embarquement/i.test(head)) return 'billet';
  if (/---\s*document\s*key\s*data\s*---|invoice|facture|due\s+date|[eé]ch[eé]ance/i.test(head)) return 'invoice_contract';
  return '';
}

function buildFactExtractionPrompt(text, filename = '', docType = '') {
  const inferred = inferDocTypeFromContent(text);
  const effectiveType = inferred || docType; // Prefer content-based detection (handles "scan.pdf" = passport)
  let ctx = '';
  if (filename) ctx += `\nFilename: ${filename}`;
  if (effectiveType) ctx += `\nDocument type: ${effectiveType}`;
  let mandatory = '';
  if (effectiveType === 'id_document') {
    mandatory = `\n\nCRITICAL — This is an identity document (passport, ID). You MUST extract: date_of_birth (from "Date de naissance" or "Date of birth"), passport_number or document_number, nationality, full_name, document_expiry_date. Look for the --- IDENTITY DOCUMENT --- block or equivalent. Never omit date_of_birth if it appears.`;
  }
  return `${FACT_EXTRACTION_SYSTEM}
${ctx}${mandatory}

Extract all structured facts from the document below. Output ONLY valid JSON. No markdown, no explanation.
Keys: snake_case. Values: exact strings as printed. One JSON object.`;
}

const REJECT_VALUES = /^(n\/?a|unknown|—|–|-|none|\.{3}|\.\.\.)$/i;

const DEFAULT_MAX_CHARS = 150000; // Full-doc indexation (was 50K)
const CHUNK_SIZE = 120000;
const CHUNK_OVERLAP = 15000; // Overlap to avoid cutting facts

async function extractFromChunk(client, chunk, filename, docType, chunkIndex) {
  const prompt = buildFactExtractionPrompt(chunk, filename, docType);
  if (chunkIndex > 0) {
    prompt += `\n[Document part ${chunkIndex + 1} — extract facts from this section only]`;
  }
  const response = await client.messages.create({
    model: process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: `${prompt}\n\n--- DOCUMENT ---\n${chunk}\n--- END ---` }],
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
}

function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks;
}

async function extractFactsViaAI(text, options = {}) {
  const { filename = '', docType = '' } = options;
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key || !text || typeof text !== 'string') return [];
  const maxChars = Number(process.env.EVA_FACT_EXTRACTION_MAX_CHARS) || DEFAULT_MAX_CHARS;
  const fullText = text.trim().slice(0, 500000); // Cap at storage limit
  if (fullText.length < 10) return [];
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key.trim() });
    const seenKeys = new Set();
    const allFacts = [];
    if (fullText.length <= maxChars) {
      const facts = await extractFromChunk(client, fullText, filename, docType, 0);
      return facts;
    }
    const chunks = chunkText(fullText.slice(0, maxChars), CHUNK_SIZE, CHUNK_OVERLAP);
    for (let i = 0; i < chunks.length; i++) {
      const facts = await extractFromChunk(client, chunks[i], filename, docType, i);
      for (const f of facts) {
        if (!seenKeys.has(f.key)) {
          seenKeys.add(f.key);
          allFacts.push(f);
        }
      }
    }
    return allFacts;
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
