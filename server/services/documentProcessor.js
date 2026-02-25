/**
 * Extract text from uploaded documents (PDF, TXT) for Memory Vault search.
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

const MIN_TEXT_FOR_AI_FALLBACK = 20;
const MAX_PDF_FOR_CLAUDE_MB = 20;

const BILLET_KEYWORDS = /billet|ticket|boarding|emirates|etihad|flydubai|flight|itin[eé]raire|voyage/i;

async function extractPdfFromBuffer(buffer, filename = '') {
  const isBillet = BILLET_KEYWORDS.test((filename || '').toLowerCase());
  if (isBillet) {
    return extractPdfViaClaude(buffer, filename);
  }
  try {
    const pdf = require('pdf-parse');
    const data = await pdf(buffer);
    const text = (data?.text || '').trim();
    if (text && text.length >= MIN_TEXT_FOR_AI_FALLBACK) return text;
    return extractPdfViaClaude(buffer, filename);
  } catch (e) {
    console.warn('[DocumentProcessor] PDF extraction failed:', e.message);
    return extractPdfViaClaude(buffer, filename);
  }
}

async function extractPdfViaClaude(buffer, filename = '') {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) {
    console.warn('[DocumentProcessor] No ANTHROPIC_API_KEY — skipped AI OCR');
    return null;
  }
  if (buffer.length > MAX_PDF_FOR_CLAUDE_MB * 1024 * 1024) {
    console.warn('[DocumentProcessor] PDF too large for Claude (>', MAX_PDF_FOR_CLAUDE_MB, 'MB)');
    return null;
  }
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key.trim() });
    const base64 = buffer.toString('base64');
    const model = process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514';
    const response = await client.messages.create(
      {
        model,
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: `Extract ALL text from this document. Return ONLY the extracted text. Preserve order. If scanned/handwritten, transcribe it.
For flight tickets/billets: ADD at the start a structured block:
--- FLIGHT DATES ---
Departure date: [exact day + month from document, e.g. 02 mars or 2 March]
Departure time: [local time]
Arrival date: [exact day + month]
Arrival time: [local time]
Route: [e.g. DXB-PVG]
--- END ---
Then the full extracted text. Be precise: 01 vs 02, 1 vs 2 mars — these differ.` },
          ],
        }],
      },
      { headers: { 'anthropic-beta': 'pdfs-2024-09-25' } }
    );
    const textBlock = response.content?.find((b) => b.type === 'text');
    return (textBlock?.text || '').trim() || null;
  } catch (e) {
    console.warn('[DocumentProcessor] Claude PDF OCR failed:', e.message);
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

async function extractImageViaClaude(buffer, ext) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) {
    console.warn('[DocumentProcessor] No ANTHROPIC_API_KEY — skipped AI image OCR');
    return null;
  }
  if (buffer.length > MAX_IMAGE_FOR_CLAUDE_MB * 1024 * 1024) {
    console.warn('[DocumentProcessor] Image too large for Claude (>', MAX_IMAGE_FOR_CLAUDE_MB, 'MB)');
    return null;
  }
  const mediaType = IMAGE_MEDIA_TYPES[ext] || 'image/jpeg';
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key.trim() });
    const base64 = buffer.toString('base64');
    const model = process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514';
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Extract ALL text visible in this image. Return ONLY the extracted text. Preserve order. Include handwritten text, labels, tables, captions.' },
        ],
      }],
    });
    const textBlock = response.content?.find((b) => b.type === 'text');
    return (textBlock?.text || '').trim() || null;
  } catch (e) {
    console.warn('[DocumentProcessor] Claude image OCR failed:', e.message);
    return null;
  }
}

async function extractImageOcr(buffer, ext) {
  return extractImageViaClaude(buffer, ext);
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
    return extractImageOcr(buffer, ext);
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
 */
async function getRecentDocuments(ownerId, limit = 5) {
  try {
    const r = await db.query(
      `SELECT id, filename, content_text, created_at
       FROM eva.documents
       WHERE owner_id = $1 AND content_text IS NOT NULL AND content_text != '' AND status = 'indexed'
       ORDER BY created_at DESC
       LIMIT $2`,
      [ownerId, Math.min(limit, 15)]
    );
    return r.rows;
  } catch (e) {
    if (/column "content_text" does not exist/i.test(String(e.message))) return [];
    throw e;
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

module.exports = { extractText, processDocument, searchDocuments, getRecentDocuments, reindexAllDocuments };
