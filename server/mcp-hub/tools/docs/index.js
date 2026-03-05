/**
 * docs.* — READ-ONLY document tools for EVA Memory Vault
 * Queries eva.documents and eva.document_chunks. Tenant isolation via owner_id.
 */
import { query } from '../../core/db.js';
import { redactObject } from '../../core/redaction.js';
function parseOwnerId(arg) {
    if (arg == null)
        return null;
    const n = typeof arg === 'number' ? arg : parseInt(String(arg), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}
function parseScope(arg) {
    const s = String(arg || 'tenant').toLowerCase();
    return s === 'personal' || s === 'all' ? s : 'tenant';
}
export async function docsList(args, ctx) {
    const ownerId = parseOwnerId(args.owner_id ?? ctx.tenant_id);
    const scope = parseScope(args.scope);
    const limit = Math.min(Number(args.limit) || 50, 200);
    if (!ownerId) {
        return { ok: false, error: 'owner_id required (EVA owner / tenant scope)' };
    }
    try {
        await query('SET search_path TO eva, public');
        const { rows } = await query(`SELECT id AS doc_id, filename, file_type, file_size, status, chunk_count, created_at, processed_at
       FROM eva.documents
       WHERE owner_id = $1
       ORDER BY created_at DESC
       LIMIT $2`, [ownerId, limit]);
        const data = redactObject({
            documents: rows,
            scope,
            count: rows.length,
        });
        return { ok: true, data };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
export async function docsSearch(args, ctx) {
    const queryArg = args.query;
    const ownerId = parseOwnerId(args.owner_id ?? ctx.tenant_id);
    const topK = Math.min(Number(args.top_k) || 8, 20);
    if (!queryArg || typeof queryArg !== 'string' || queryArg.trim().length < 2) {
        return { ok: false, error: 'query (string, min 2 chars) required' };
    }
    if (!ownerId) {
        return { ok: false, error: 'owner_id required' };
    }
    const q = queryArg.trim().replace(/'/g, "''");
    const likePattern = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    try {
        await query('SET search_path TO eva, public');
        // Prefer chunk search if document_chunks exists
        let rows;
        try {
            const r = await query(`SELECT dc.chunk_id::text, dc.doc_id, dc.chunk_index, d.filename, dc.content
         FROM eva.document_chunks dc
         JOIN eva.documents d ON d.id = dc.doc_id AND d.owner_id = dc.owner_id
         WHERE dc.owner_id = $1
           AND (dc.tsv @@ plainto_tsquery('simple', $2) OR dc.content ILIKE $3)
         ORDER BY ts_rank(dc.tsv, plainto_tsquery('simple', $2)) DESC NULLS LAST
         LIMIT $4`, [ownerId, q, likePattern, topK]);
            rows = r.rows.map((row) => ({
                chunk_id: row.chunk_id,
                doc_id: row.doc_id,
                chunk_index: row.chunk_index,
                filename: row.filename,
                content: (row.content || '').slice(0, 2000),
                citation: { doc_id: row.doc_id, filename: row.filename, chunk_index: row.chunk_index, chunk_id: row.chunk_id },
            }));
        }
        catch {
            // Fallback to documents table if document_chunks doesn't exist
            const r = await query(`SELECT id AS doc_id, filename, content_text
         FROM eva.documents
         WHERE owner_id = $1 AND content_text IS NOT NULL AND content_text != ''
           AND (content_text ILIKE $2 OR filename ILIKE $2)
         ORDER BY created_at DESC
         LIMIT $3`, [ownerId, likePattern, topK]);
            rows = r.rows.map((row) => ({
                chunk_id: '',
                doc_id: row.doc_id,
                chunk_index: 0,
                filename: row.filename,
                content: (row.content_text || '').slice(0, 2000),
                citation: { doc_id: row.doc_id, filename: row.filename, chunk_index: 0, chunk_id: '' },
            }));
        }
        const data = redactObject({ results: rows, query: queryArg, count: rows.length });
        return { ok: true, data };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
export async function docsReadChunk(args, ctx) {
    const chunkId = args.chunk_id;
    const ownerId = parseOwnerId(args.owner_id ?? ctx.tenant_id);
    if (!chunkId || typeof chunkId !== 'string') {
        return { ok: false, error: 'chunk_id required' };
    }
    if (!ownerId) {
        return { ok: false, error: 'owner_id required' };
    }
    try {
        await query('SET search_path TO eva, public');
        const { rows } = await query(`SELECT dc.chunk_id::text, dc.doc_id, dc.chunk_index, dc.content, d.filename
       FROM eva.document_chunks dc
       JOIN eva.documents d ON d.id = dc.doc_id AND d.owner_id = dc.owner_id
       WHERE dc.chunk_id = $1::uuid AND dc.owner_id = $2`, [chunkId, ownerId]);
        const row = rows[0];
        if (!row) {
            return { ok: false, error: 'Chunk not found or access denied' };
        }
        const data = redactObject({
            chunk_id: row.chunk_id,
            doc_id: row.doc_id,
            chunk_index: row.chunk_index,
            filename: row.filename,
            content: row.content,
            citation: { doc_id: row.doc_id, filename: row.filename, chunk_index: row.chunk_index, chunk_id: row.chunk_id },
        });
        return { ok: true, data };
    }
    catch (err) {
        if (/relation "eva\.document_chunks" does not exist/i.test(err.message)) {
            return { ok: false, error: 'document_chunks table not found. Run: cd eva && node scripts/run-migrations.js' };
        }
        return { ok: false, error: err.message };
    }
}
function parseId(arg) {
    if (arg == null)
        return null;
    const n = typeof arg === 'number' ? arg : parseInt(String(arg), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
}
export async function docsGetDoc(args, ctx) {
    const docId = parseId(args.doc_id);
    const ownerId = parseOwnerId(args.owner_id ?? ctx.tenant_id);
    if (!docId) {
        return { ok: false, error: 'doc_id required' };
    }
    if (!ownerId) {
        return { ok: false, error: 'owner_id required' };
    }
    try {
        await query('SET search_path TO eva, public');
        const { rows } = await query(`SELECT id AS doc_id, filename, file_type, status, chunk_count, content_text, processed_at, created_at
       FROM eva.documents
       WHERE id = $1 AND owner_id = $2`, [docId, ownerId]);
        const row = rows[0];
        if (!row) {
            return { ok: false, error: 'Document not found or access denied' };
        }
        const data = redactObject({
            doc_id: row.doc_id,
            filename: row.filename,
            file_type: row.file_type,
            status: row.status,
            chunk_count: row.chunk_count,
            content_text: (row.content_text || '').slice(0, 50000),
            processed_at: row.processed_at,
            created_at: row.created_at,
        });
        return { ok: true, data };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
