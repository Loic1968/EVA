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

const ID_DOCUMENT_PROMPT = `Identity document (passport, ID card, driving license). Extract EVERY visible field with character-level accuracy.

REQUIRED structured block at start — copy values EXACTLY as printed (no reformatting):
--- IDENTITY DOCUMENT ---
Full name / Nom complet: [verbatim]
Date of birth / Date de naissance: [exact: 15 mars 1985 or 15/03/1985 — as written]
Place of birth / Lieu de naissance: [if visible]
Document number / Numéro: [exact digits/letters]
Nationality / Nationalité: [exact]
Expiry date / Date d'expiration: [exact]
Issue date / Date de délivrance: [if visible]
Sex / Sexe: [M/F if visible]
--- END ---
Then full text. CRITICAL: 1 vs 01, mars vs mars — match the document character-for-character. Do NOT normalize dates.`;

const INVOICE_CONTRACT_PROMPT = `Invoice, quote, or contract. Extract every field with exact values.

--- DOCUMENT KEY DATA ---
Date / Date: [exact as printed]
Reference / N°: [invoice, order, contract number — exact]
Supplier / Client: [exact name]
Amounts: [exact numbers, decimals, currency symbols]
Due date / Date échéance: [exact if visible]
--- END ---
Then full text. Preserve decimal places, currency format, date format. No rounding or reformatting.`;

const BILLET_PROMPT = `Flight/travel document. Extract with precision.

--- FLIGHT DATES ---
Departure date: [exact day + month — 1 vs 01, mars vs March as written]
Departure time: [exact local time]
Arrival date: [exact — may differ from departure if overnight]
Arrival time: [exact]
Route: [e.g. DXB-PVG — exact codes]
--- END ---
Then full text. CRITICAL: 2 mars vs 1er mars vs 02/03 — these differ. Copy exactly.`;

const DEFAULT_EXTRACT_PROMPT = `Extract EVERY piece of text with maximum accuracy. Character-for-character where legible.

RULES:
- Dates: exact format (15 mars 1985, 15/03/1985, 02-03-26 — as printed)
- Amounts: exact decimals, currency, no rounding
- Names/numbers: exact spelling and digits
- Tables: row by row, no omission
- If illegible: indicate [illegible] rather than guessing
- Output: full text in reading order. No summaries.`;

async function extractViaClaude(buffer, filename = '', docType, mediaType) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY not set. Document indexing requires Claude.');
  }
  const isPdf = mediaType === 'application/pdf';
  if (isPdf && buffer.length > MAX_PDF_FOR_CLAUDE_MB * 1024 * 1024) {
    throw new Error(`PDF too large (>${MAX_PDF_FOR_CLAUDE_MB}MB). Max for Claude: ${MAX_PDF_FOR_CLAUDE_MB}MB.`);
  }
  if (!isPdf && buffer.length > MAX_IMAGE_FOR_CLAUDE_MB * 1024 * 1024) {
    throw new Error(`Image too large (>${MAX_IMAGE_FOR_CLAUDE_MB}MB). Max for Claude: ${MAX_IMAGE_FOR_CLAUDE_MB}MB.`);
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
        model: process.env.EVA_DOCUMENT_MODEL || 'claude-sonnet-4-20250514',
        // Note: EVA_CHAT_MODEL is intentionally NOT used here — it may be an OpenAI model (gpt-4o-mini)
        max_tokens: 16000,
        messages: [{ role: 'user', content: [contentType, { type: 'text', text: prompt }] }],
      },
      isPdf ? { headers: { 'anthropic-beta': 'pdfs-2024-09-25' } } : {}
    );
    const textBlock = response.content?.find((b) => b.type === 'text');
    const text = (textBlock?.text || '').trim();
    if (!text) throw new Error('Claude returned empty response');
    return text;
  } catch (e) {
    const errBody = e.error?.error?.message || e.message || 'Extraction failed';
    const status = e.status || e.statusCode || '?';
    console.warn(`[DocumentProcessor] Claude extraction failed (${status}):`, errBody);
    // Propagate API/configuration errors so they're stored in document metadata for the UI
    throw new Error(`Claude ${status}: ${errBody}`);
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

const IMAGE_MEDIA_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' };
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
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(ext)) {
    const buffer = isBuffer ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);
    return extractImageOcr(buffer, ext, filename);
  }
  if (ext === 'docx' || ext === 'doc') {
    const buffer = isBuffer ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);
    return extractDocxFromBuffer(buffer);
  }
  return null;
}

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || text.length <= size) return text ? [text] : [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    // Prefer sentence boundary for cleaner chunks
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const best = Math.max(lastPeriod, lastNewline);
      if (best > start + size / 2) end = best + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start >= text.length - overlap) break;
  }
  return chunks.filter((c) => c.length > 0);
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
      const contentText = text.slice(0, 500000);
      await db.query(
        "UPDATE eva.documents SET content_text = $1, status = 'indexed', processed_at = now() WHERE id = $2",
        [contentText, documentId]
      );
      // Chunk and index for search with citations
      try {
        await db.query('DELETE FROM eva.document_chunks WHERE doc_id = $1', [documentId]);
        const chunks = chunkText(contentText);
        for (let i = 0; i < chunks.length; i++) {
          await db.query(
            `INSERT INTO eva.document_chunks (doc_id, owner_id, chunk_index, content)
             VALUES ($1, $2, $3, $4)`,
            [documentId, ownerId, i, chunks[i]]
          );
        }
        await db.query(
          "UPDATE eva.documents SET chunk_count = $1 WHERE id = $2",
          [chunks.length, documentId]
        );
      } catch (chunkErr) {
        if (!/relation "eva\.document_chunks" does not exist/i.test(String(chunkErr.message))) {
          console.warn(`[DocumentProcessor] Chunk index failed (run migration): ${chunkErr.message}`);
        }
      }
      // Structured memory: extract facts into eva.facts when feature-flagged
      if (process.env.EVA_STRUCTURED_MEMORY === 'true') {
        try {
          const factsService = require('./factsService');
          const docType = detectDocumentType(doc.filename || '');
          const n = await factsService.extractAndUpsertFromDocument(ownerId, documentId, text, {
            filename: doc.filename || '',
            docType: docType || 'general',
          });
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

async function searchDocumentsByChunks(ownerId, queryText, limit = 8) {
  const q = (queryText || '').trim();
  if (!q || q.length < 2) return [];

  const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length >= 2 && !SEARCH_STOPWORDS.has(w));
  const tsQuery = words.slice(0, 5).map((w) => w.replace(/'/g, "''")).join(' & ');

  try {
    const r = await db.query(
      `SELECT dc.chunk_id, dc.doc_id, dc.chunk_index, dc.content,
              d.filename, d.content_text
       FROM eva.document_chunks dc
       JOIN eva.documents d ON d.id = dc.doc_id AND d.owner_id = dc.owner_id
       WHERE dc.owner_id = $1
         AND (dc.tsv @@ plainto_tsquery('simple', $2) OR dc.content ILIKE $3)
       ORDER BY ts_rank(dc.tsv, plainto_tsquery('simple', $2)) DESC NULLS LAST,
                dc.doc_id, dc.chunk_index
       LIMIT $4`,
      [ownerId, tsQuery || q, `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`, limit]
    );
    return r.rows.map((row) => ({
      id: row.doc_id,
      chunk_id: row.chunk_id,
      chunk_index: row.chunk_index,
      filename: row.filename,
      content_text: row.content,
      content_preview: row.content?.slice(0, 1500),
      citation: { doc_id: row.doc_id, filename: row.filename, chunk_index: row.chunk_index, chunk_id: row.chunk_id },
    }));
  } catch (e) {
    if (/relation "eva\.document_chunks" does not exist/i.test(String(e.message))) return [];
    throw e;
  }
}

function searchDocuments(ownerId, queryText, limit = 5) {
  const q = (queryText || '').trim();
  if (!q || q.length < 2) return Promise.resolve([]);

  const likePattern = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';

  // Extract meaningful words (2+ chars) for OR-query — "vol lundi shanghai" finds flight docs
  const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length >= 2 && !SEARCH_STOPWORDS.has(w));
  const orTerms = [...new Set(words)].slice(0, 6).map((w) => w.replace(/'/g, "''").replace(/[^a-z0-9\u00e0-\u00ff]/g, ''));

  // Content match: ILIKE on content_text + optional tsvector
  let contentCond = 'content_text ILIKE $2 ESCAPE \'\\\'';
  if (orTerms.length > 0) {
    const tsParts = orTerms.map((t, i) => `to_tsvector('simple', content_text) @@ plainto_tsquery('simple', $${i + 3})`).join(' OR ');
    contentCond = `(${tsParts}) OR ${contentCond}`;
  }

  // Filename match: "Emirates ticket" / "Emirates ticket.pdf" finds docs by name
  const filenameLike = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c).replace(/'/g, "''") + '%';
  const filenameParamIdx = 2 + orTerms.length + 1; // $1=ownerId, $2=likePattern, $3..=orTerms, next=filenameLike
  const filenameCond = `(filename IS NOT NULL AND filename ILIKE $${filenameParamIdx} ESCAPE '\\')`;

  const cond = `(${contentCond}) OR ${filenameCond}`;
  const params = [ownerId, likePattern, ...orTerms, filenameLike, limit];

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

async function searchDocumentsWithCitations(ownerId, queryText, limit = 8) {
  const chunkResults = await searchDocumentsByChunks(ownerId, queryText, limit);
  if (chunkResults.length > 0) return chunkResults;
  const docResults = await searchDocuments(ownerId, queryText, limit);
  return docResults.map((d) => ({
    ...d,
    content_preview: (d.content_text || '').slice(0, 3000),
    citation: { doc_id: d.id, filename: d.filename, chunk_index: 0, chunk_id: null },
  }));
}

/**
 * Search documents by filename (e.g. "Emirates ticket.pdf").
 * Used when user explicitly names a file. Returns full content.
 */
async function searchDocumentsByFilename(ownerId, filenamePart, limit = 3) {
  const part = (filenamePart || '').trim();
  if (!part || part.length < 2) return [];
  const like = '%' + part.replace(/[%_\\]/g, (c) => '\\' + c).replace(/'/g, "''") + '%';
  try {
    const r = await db.query(
      `SELECT id, filename, content_text, created_at
       FROM eva.documents
       WHERE owner_id = $1 AND content_text IS NOT NULL AND content_text != ''
         AND filename ILIKE $2 ESCAPE '\\'
       ORDER BY created_at DESC
       LIMIT $3`,
      [ownerId, like, Math.min(limit, 5)]
    );
    return r.rows;
  } catch (e) {
    if (/column "content_text" does not exist/i.test(String(e.message))) return [];
    return [];
  }
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

async function getChunk(chunkId, ownerId) {
  try {
    const r = await db.query(
      `SELECT dc.chunk_id, dc.doc_id, dc.chunk_index, dc.content, d.filename
       FROM eva.document_chunks dc
       JOIN eva.documents d ON d.id = dc.doc_id AND d.owner_id = dc.owner_id
       WHERE dc.chunk_id = $1 AND dc.owner_id = $2`,
      [chunkId, ownerId]
    );
    return r.rows[0] || null;
  } catch (e) {
    if (/relation "eva\.document_chunks" does not exist/i.test(String(e.message))) return null;
    throw e;
  }
}

async function getDoc(docId, ownerId) {
  try {
    const r = await db.query(
      'SELECT id, filename, content_text, status, chunk_count, processed_at FROM eva.documents WHERE id = $1 AND owner_id = $2',
      [docId, ownerId]
    );
    return r.rows[0] || null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  extractText,
  processDocument,
  searchDocuments,
  searchDocumentsByChunks,
  searchDocumentsWithCitations,
  searchDocumentsByFilename,
  getRecentDocuments,
  getDocumentStats,
  reindexAllDocuments,
  getChunk,
  getDoc,
};
