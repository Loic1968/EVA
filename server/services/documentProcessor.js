/**
 * Extract text from uploaded documents (PDF, TXT) for Memory Vault search.
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

const MIN_TEXT_LENGTH_FOR_OCR_FALLBACK = 20;

async function extractPdfFromBuffer(buffer) {
  try {
    const pdf = require('pdf-parse');
    const data = await pdf(buffer);
    const text = (data?.text || '').trim();
    if (text && text.length >= MIN_TEXT_LENGTH_FOR_OCR_FALLBACK) return text;
    // Fallback: OCR for scanned/image-only PDFs
    return extractPdfViaOcr(buffer);
  } catch (e) {
    console.warn('[DocumentProcessor] PDF extraction failed:', e.message);
    return extractPdfViaOcr(buffer);
  }
}

async function extractPdfViaOcr(buffer) {
  try {
    const mod = await import('pdf-img-convert');
    const convert = mod.convert || mod.default;
    const { createWorker } = require('tesseract.js');
    const pageImages = await convert(buffer, { scale: 2 });
    if (!pageImages || pageImages.length === 0) return null;
    const worker = await createWorker('eng');
    const texts = [];
    try {
      for (let i = 0; i < pageImages.length; i++) {
        const imgBuf = Buffer.from(pageImages[i]);
        const { data: { text } } = await worker.recognize(imgBuf);
        if (text && text.trim()) texts.push(text.trim());
      }
      await worker.terminate();
      return texts.join('\n\n') || null;
    } catch (e) {
      await worker.terminate();
      throw e;
    }
  } catch (e) {
    console.warn('[DocumentProcessor] PDF OCR fallback failed:', e.message);
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

async function extractImageOcr(buffer) {
  try {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('eng');
    try {
      const { data: { text } } = await worker.recognize(buffer);
      await worker.terminate();
      return (text || '').trim();
    } catch (e) {
      await worker.terminate();
      throw e;
    }
  } catch (e) {
    console.warn('[DocumentProcessor] OCR failed:', e.message);
    return null;
  }
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

async function extractText(filePathOrBuffer, fileType) {
  const isBuffer = Buffer.isBuffer(filePathOrBuffer);
  const ext = (fileType || (!isBuffer && path.extname(filePathOrBuffer)) || '').toLowerCase().replace('.', '');
  if (ext === 'pdf') {
    const buffer = isBuffer ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);
    return extractPdfFromBuffer(buffer);
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
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    const buffer = isBuffer ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);
    return extractImageOcr(buffer);
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
    const text = await extractText(input, doc.file_type);
    if (text && text.length > 0) {
      await db.query(
        "UPDATE eva.documents SET content_text = $1, status = 'indexed', processed_at = now() WHERE id = $2",
        [text.slice(0, 500000), documentId]
      );
    } else {
      await db.query(
        "UPDATE eva.documents SET status = 'error', metadata = metadata || $1 WHERE id = $2",
        [JSON.stringify({ error: 'No text extracted. OCR was attempted. File may be corrupted or in an unsupported format.' }), documentId]
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

function searchDocuments(ownerId, queryText, limit = 5) {
  const q = (queryText || '').trim();
  if (!q || q.length < 2) return Promise.resolve([]);

  const safeQuery = q.replace(/'/g, "''");
  const likePattern = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
  return db
    .query(
      `SELECT id, filename, file_type, left(content_text, 2000) AS content_preview, created_at
       FROM eva.documents
       WHERE owner_id = $1
         AND content_text IS NOT NULL
         AND content_text != ''
         AND (
           to_tsvector('simple', content_text) @@ plainto_tsquery('simple', $2)
           OR content_text ILIKE $3 ESCAPE '\\'
         )
       ORDER BY created_at DESC
       LIMIT $4`,
      [ownerId, safeQuery, likePattern, limit]
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

module.exports = { extractText, processDocument, searchDocuments, getRecentDocuments };
