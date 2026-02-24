/**
 * Extract text from uploaded documents (PDF, TXT) for Memory Vault search.
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

async function extractPdfText(filePath) {
  try {
    const pdf = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdf(buffer);
    return (data?.text || '').trim();
  } catch (e) {
    console.warn('[DocumentProcessor] PDF extraction failed:', e.message);
    return null;
  }
}

function extractTxtContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch (e) {
    console.warn('[DocumentProcessor] TXT read failed:', e.message);
    return null;
  }
}

async function extractText(filePath, fileType) {
  const ext = (fileType || path.extname(filePath) || '').toLowerCase().replace('.', '');
  if (ext === 'pdf') return extractPdfText(filePath);
  if (['txt', 'text', 'csv'].includes(ext)) return extractTxtContent(filePath);
  return null;
}

async function processDocument(documentId, ownerId) {
  const r = await db.query(
    'SELECT id, storage_path, file_type, filename FROM eva.documents WHERE id = $1 AND owner_id = $2',
    [documentId, ownerId]
  );
  const doc = r.rows[0];
  if (!doc || !doc.storage_path || !fs.existsSync(doc.storage_path)) {
    await db.query(
      "UPDATE eva.documents SET status = 'error', metadata = metadata || $1 WHERE id = $2",
      [JSON.stringify({ error: 'File not found' }), documentId]
    );
    return null;
  }

  try {
    await db.query("UPDATE eva.documents SET status = 'processing' WHERE id = $1", [documentId]);
    const text = await extractText(doc.storage_path, doc.file_type);
    if (text && text.length > 0) {
      await db.query(
        "UPDATE eva.documents SET content_text = $1, status = 'indexed', processed_at = now() WHERE id = $2",
        [text.slice(0, 500000), documentId]
      );
    } else {
      await db.query(
        "UPDATE eva.documents SET status = 'uploaded', metadata = metadata || $1 WHERE id = $2",
        [JSON.stringify({ extraction: 'no_text' }), documentId]
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
