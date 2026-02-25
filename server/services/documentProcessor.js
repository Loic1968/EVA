/**
 * Extract text from uploaded documents (PDF, TXT) for Memory Vault search.
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

const MIN_TEXT_FOR_AI_FALLBACK = 20;
const MAX_PDF_FOR_CLAUDE_MB = 20;
// Use Claude for ALL PDFs when true (better quality than pdf-parse for scanned/invoices/contracts)
const USE_CLAUDE_FOR_ALL_PDFS = process.env.EVA_USE_CLAUDE_FOR_ALL_PDFS !== 'false';

const BILLET_KEYWORDS = /billet|ticket|boarding|emirates|etihad|flydubai|flight|itin[eé]raire|voyage/i;
const ID_DOCUMENT_KEYWORDS = /passport|passeport|cni|piece\s*identit[eé]|carte\s*d['\u2019]identit[eé]|id\s*card|permis|driving\s*license|nationalit[eé]|date\s*de\s*naissance|birth\s*date|identity|pièce/i;
const INVOICE_CONTRACT_KEYWORDS = /facture|invoice|devis|contrat|contract|achat|purchase|commande|order/i;

function detectDocumentType(filename = '') {
  const lower = (filename || '').toLowerCase();
  if (BILLET_KEYWORDS.test(lower)) return 'billet';
  if (ID_DOCUMENT_KEYWORDS.test(lower)) return 'id_document';
  if (INVOICE_CONTRACT_KEYWORDS.test(lower)) return 'invoice_contract';
  return null;
}

async function extractPdfFromBuffer(buffer, filename = '') {
  const docType = detectDocumentType(filename);
  if (docType === 'billet' || docType === 'id_document' || docType === 'invoice_contract' || USE_CLAUDE_FOR_ALL_PDFS) {
    return extractViaClaude(buffer, filename, docType || null, 'application/pdf');
  }
  try {
    const pdf = require('pdf-parse');
    const data = await pdf(buffer);
    const text = (data?.text || '').trim();
    if (text && text.length >= MIN_TEXT_FOR_AI_FALLBACK) return text;
    return extractViaClaude(buffer, filename, null, 'application/pdf');
  } catch (e) {
    console.warn('[DocumentProcessor] PDF extraction failed:', e.message);
    return extractViaClaude(buffer, filename, null, 'application/pdf');
  }
}

const ID_DOCUMENT_PROMPT = `This is an identity document (passport, ID card, driving license). Extract EVERY visible field.

REQUIRED: Add at the start this structured block with the EXACT values from the document:
--- IDENTITY DOCUMENT ---
Full name / Nom complet: [exact as shown]
Date of birth / Date de naissance: [exact date, e.g. 15 mars 1985 or 15/03/1985]
Place of birth / Lieu de naissance: [if visible]
Document number / Numéro: [passport/ID number]
Nationality / Nationalité: [exact]
Expiry date / Date d'expiration: [exact]
Issue date / Date de délivrance: [if visible]
Sex / Sexe: [M/F if visible]
--- END ---
Then the full extracted text in order. Be PRECISE: dates, numbers, spellings must match the document exactly. Do NOT omit any field. Date de naissance is CRITICAL — extract it.`;

const INVOICE_CONTRACT_PROMPT = `This is an invoice, quote, or contract. Extract EVERY field.

Add at the start:
--- DOCUMENT KEY DATA ---
Date / Date: [exact]
Reference / N°: [invoice, order, contract number]
Supplier / Client: [name]
Amounts: [all amounts, VAT, totals — exact numbers]
Due date / Date échéance: [if visible]
--- END ---
Then the full extracted text. No omissions. Every date, amount, and reference must be captured.`;

const BILLET_PROMPT = `Extract ALL text from this document. Add at the start:
--- FLIGHT DATES ---
Departure date: [exact day + month from document]
Departure time: [local time]
Arrival date: [exact day + month]
Arrival time: [local time]
Route: [e.g. DXB-PVG]
--- END ---
Then the full extracted text. Be precise: 01 vs 02, 1 vs 2 mars — these differ.`;

const DEFAULT_EXTRACT_PROMPT = `Extract EVERY piece of text from this document. Nothing can be omitted.

RULES:
- Extract ALL dates (dates de naissance, expiration, livraison, facturation, etc.)
- Extract ALL amounts (montants, prix, totaux, TVA)
- Extract ALL names (personnes, sociétés, adresses)
- Extract ALL reference numbers (facture, commande, contrat, passport)
- Preserve exact spelling and formatting. 01 vs 02, mars vs mars — be precise.
- If scanned/handwritten: transcribe fully. If tables: extract row by row.
- Output: full extracted text in reading order. No summaries. No omissions.`;

async function extractViaClaude(buffer, filename = '', docType, mediaType) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) {
    console.warn('[DocumentProcessor] No ANTHROPIC_API_KEY — skipped AI OCR');
    return null;
  }
  const isPdf = mediaType === 'application/pdf';
  if (isPdf && buffer.length > MAX_PDF_FOR_CLAUDE_MB * 1024 * 1024) {
    console.warn('[DocumentProcessor] PDF too large for Claude (>', MAX_PDF_FOR_CLAUDE_MB, 'MB)');
    return null;
  }
  if (!isPdf && buffer.length > MAX_IMAGE_FOR_CLAUDE_MB * 1024 * 1024) {
    console.warn('[DocumentProcessor] Image too large for Claude (>', MAX_IMAGE_FOR_CLAUDE_MB, 'MB)');
    return null;
  }
  const prompt = docType === 'id_document' ? ID_DOCUMENT_PROMPT
    : docType === 'billet' ? BILLET_PROMPT
    : docType === 'invoice_contract' ? INVOICE_CONTRACT_PROMPT
    : DEFAULT_EXTRACT_PROMPT;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key.trim() });
    const base64 = buffer.toString('base64');
    const contentType = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } };
    const response = await client.messages.create(
      {
        model: process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        messages: [{ role: 'user', content: [contentType, { type: 'text', text: prompt }] }],
      },
      isPdf ? { headers: { 'anthropic-beta': 'pdfs-2024-09-25' } } : {}
    );
    const textBlock = response.content?.find((b) => b.type === 'text');
    return (textBlock?.text || '').trim() || null;
  } catch (e) {
    console.warn('[DocumentProcessor] Claude extraction failed:', e.message);
    return null;
  }
}

function extractTxtFromBuffer(buffer) {
  try {
    return (buffer.toString('utf-8') || '').trim();
  } catch (e) {
    console.warn('[DocumentProcessor] TXT read failed:', e.message);
    return null;
  }
}

const IMAGE_MEDIA_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const MAX_IMAGE_FOR_CLAUDE_MB = 5;

// Images now route through extractViaClaude via extractImageOcr (with doc type detection)

async function extractImageOcr(buffer, ext, filename = '') {
  const docType = detectDocumentType(filename);
  const mediaType = IMAGE_MEDIA_TYPES[ext] || 'image/jpeg';
  return extractViaClaude(buffer, filename, docType, mediaType);
}

async function extractDocxFromBuffer(buffer) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return (result?.value || '').trim();
  } catch (e) {
    console.warn('[DocumentProcessor] DOCX extraction failed:', e.message);
    return null;
  }
}

async function extractText(filePathOrBuffer, fileType, filename = '') {
  const isBuffer = Buffer.isBuffer(filePathOrBuffer);
  const ext = (fileType || (!isBuffer && path.extname(filePathOrBuffer)) || '').toLowerCase().replace('.', '');
  if (ext === 'pdf') {
    const buffer = isBuffer ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);
    return extractPdfFromBuffer(buffer, filename);
  }
  if (['txt', 'text', 'csv'].includes(ext)) {
    if (isBuffer) return extractTxtFromBuffer(filePathOrBuffer);
    try {
      return fs.readFileSync(filePathOrBuffer, 'utf-8').trim() || null;
    } catch (e) {
      console.warn('[DocumentProcessor] TXT read failed:', e.message);
      return null;
    }
  }
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
    const buffer = isBuffer ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);
    return extractImageOcr(buffer, ext, filename);
  }
  if (ext === 'docx' || ext === 'doc') {
    const buffer = isBuffer ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);
    return extractDocxFromBuffer(buffer);
  }
  return null;
}

async function processDocument(documentId, ownerId) {
  const r = await db.query(
    'SELECT id, storage_path, file_type, filename, file_data FROM eva.documents WHERE id = $1 AND owner_id = $2',
    [documentId, ownerId]
  );
  const doc = r.rows[0];
  if (!doc) {
    return null;
  }

  // Prefer file on disk; fallback to file_data (persisted in DB for prod/ephemeral fs)
  let input = null;
  if (doc.storage_path && fs.existsSync(doc.storage_path)) {
    input = doc.storage_path;
  } else if (doc.file_data) {
    // pg returns BYTEA as Buffer or sometimes as hex string — normalize to Buffer
    const buf = Buffer.isBuffer(doc.file_data)
      ? doc.file_data
      : Buffer.from(doc.file_data, typeof doc.file_data === 'string' ? 'hex' : undefined);
    if (buf.length > 0) input = buf;
  }
  if (!input) {
    const errMsg = !doc.file_data || (Buffer.isBuffer(doc.file_data) && doc.file_data.length === 0)
      ? 'File not stored in DB (upload may have failed). Re-upload the document.'
      : 'File not found';
    await db.query(
      "UPDATE eva.documents SET status = 'error', metadata = metadata || $1 WHERE id = $2",
      [JSON.stringify({ error: errMsg }), documentId]
    );
    console.warn(`[DocumentProcessor] Doc ${documentId}: ${errMsg}`);
    return null;
  }

  try {
    await db.query("UPDATE eva.documents SET status = 'processing' WHERE id = $1", [documentId]);
    const text = await extractText(input, doc.file_type, doc.filename || '');
    if (text && text.length > 0) {
      await db.query(
        "UPDATE eva.documents SET content_text = $1, status = 'indexed', processed_at = now() WHERE id = $2",
        [text.slice(0, 500000), documentId]
      );
      // Structured memory: extract facts into eva.facts when feature-flagged
      if (process.env.EVA_STRUCTURED_MEMORY === 'true') {
        try {
          const factsService = require('./factsService');
          const n = await factsService.extractAndUpsertFromDocument(ownerId, documentId, text);
          if (n > 0 && process.env.EVA_DEBUG === 'true') {
            console.log(`[DocumentProcessor] Extracted ${n} facts from doc ${documentId}`);
          }
        } catch (err) {
          console.warn('[DocumentProcessor] Fact extraction failed:', err.message);
        }
      }
    } else {
      await db.query(
        "UPDATE eva.documents SET status = 'error', metadata = metadata || $1 WHERE id = $2",
        [JSON.stringify({ error: 'No text extracted. AI (Claude) was used for PDFs and images — check ANTHROPIC_API_KEY and file size (PDF < 20MB, images < 5MB).' }), documentId]
      );
    }
    return text;
  } catch (e) {
    await db.query(
      "UPDATE eva.documents SET status = 'error', metadata = metadata || $1 WHERE id = $2",
      [JSON.stringify({ error: e.message }), documentId]
    );
    throw e;
  }
}

// Stopwords to skip when building OR-query (French + English)
const SEARCH_STOPWORDS = new Set(['a', 'à', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'pour', 'avec', 'mon', 'ma', 'mes', 'son', 'sa', 'ses', 'notre', 'votre', 'leur', 'quelle', 'quels', 'quelle', 'quelles', 'est', 'sont', 'the', 'is', 'are', 'my', 'your', 'our', 'to', 'for', 'with', 'at', 'in', 'on']);

function searchDocuments(ownerId, queryText, limit = 5) {
  const q = (queryText || '').trim();
  if (!q || q.length < 2) return Promise.resolve([]);

  const safeQuery = q.replace(/'/g, "''");
  const likePattern = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';

  // Extract meaningful words (2+ chars) for OR-query — "vol lundi shanghai" finds flight docs
  const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length >= 2 && !SEARCH_STOPWORDS.has(w));
  const orTerms = [...new Set(words)].slice(0, 6).map((w) => w.replace(/'/g, "''").replace(/[^a-z0-9\u00e0-\u00ff]/g, ''));

  let cond = 'content_text ILIKE $2 ESCAPE \'\\\'';
  if (orTerms.length > 0) {
    const tsParts = orTerms.map((t, i) => `to_tsvector('simple', content_text) @@ plainto_tsquery('simple', $${i + 3})`).join(' OR ');
    cond = `(${tsParts}) OR ${cond}`;
  }

  const params = [ownerId, likePattern, ...orTerms, limit];
  return db
    .query(
      `SELECT id, filename, content_text, file_type, created_at
       FROM eva.documents
       WHERE owner_id = $1
         AND content_text IS NOT NULL
         AND content_text != ''
         AND ${cond}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    )
    .then((r) => r.rows)
    .catch((e) => {
      if (/column "content_text" does not exist/i.test(String(e.message))) return [];
      throw e;
    });
}

/**
 * Get recent indexed documents for Realtime voice context (like getRecentEmails).
 * Includes docs with content_text regardless of status (handles migration/edge cases).
 */
async function getRecentDocuments(ownerId, limit = 5) {
  try {
    const r = await db.query(
      `SELECT id, filename, content_text, created_at, status
       FROM eva.documents
       WHERE owner_id = $1 AND content_text IS NOT NULL AND content_text != ''
       ORDER BY COALESCE(processed_at, created_at) DESC
       LIMIT $2`,
      [ownerId, Math.min(limit, 15)]
    );
    return r.rows;
  } catch (e) {
    if (/column "content_text" does not exist/i.test(String(e.message))) {
      console.warn('[DocumentProcessor] content_text column missing. Run: psql "$DATABASE_URL" -f eva/migrations/004_add_document_file_data.sql');
      return [];
    }
    throw e;
  }
}

/**
 * Count documents by status for diagnostics.
 */
async function getDocumentStats(ownerId) {
  try {
    const r = await db.query(
      `SELECT status, COUNT(*) as n
       FROM eva.documents
       WHERE owner_id = $1
       GROUP BY status`,
      [ownerId]
    );
    return Object.fromEntries(r.rows.map((row) => [row.status, parseInt(row.n, 10)]));
  } catch (e) {
    return {};
  }
}

/**
 * Re-index all documents for an owner (e.g. after upgrading to AI extraction).
 */
async function reindexAllDocuments(ownerId) {
  const r = await db.query(
    'SELECT id FROM eva.documents WHERE owner_id = $1 ORDER BY created_at DESC',
    [ownerId]
  );
  let ok = 0;
  let fail = 0;
  for (const row of r.rows) {
    try {
      const text = await processDocument(row.id, ownerId);
      if (text && text.length > 0) ok++;
      else fail++;
    } catch (e) {
      fail++;
    }
  }
  return { total: r.rows.length, ok, fail };
}

module.exports = { extractText, processDocument, searchDocuments, getRecentDocuments, getDocumentStats, reindexAllDocuments };
