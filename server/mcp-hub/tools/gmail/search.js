/**
 * gmail.search — Search user's synced emails (full-text, PostgreSQL tsquery).
 * Reads from eva.emails table (synced via gmailSync).
 */
import { query } from '../../core/db.js';

export async function gmailSearch(args, ctx) {
  const ownerId = args.owner_id ?? ctx.actor_id;
  const q = (args.query || '').trim();
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 8));
  const folder = args.folder || 'all'; // 'all' | 'inbox' | 'sent'

  if (!ownerId) return { ok: false, error: 'owner_id required' };
  if (!q) return { ok: false, error: 'query required' };

  try {
    // Build tsquery words (min 2 chars, max 6 words)
    const words = [...new Set(
      q.split(/\s+/).filter(w => w.length >= 2).slice(0, 6)
    )];
    if (words.length === 0) return { ok: true, data: { emails: [], count: 0 } };

    const tsquery = words.map(w => w.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüçæœ]/g, '')).filter(Boolean).join(' | ');
    if (!tsquery) return { ok: true, data: { emails: [], count: 0 } };

    let folderFilter = '';
    if (folder === 'inbox') folderFilter = `AND labels @> ARRAY['INBOX']::text[]`;
    else if (folder === 'sent') folderFilter = `AND labels @> ARRAY['SENT']::text[]`;

    const sql = `
      SELECT id, gmail_account_id, thread_id, from_email, from_name, to_emails,
             subject, snippet, left(body_plain, 5000) as body_preview,
             received_at, labels, is_read, is_starred, has_attachments,
             ts_rank(to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(body_plain,'')),
                     to_tsquery('simple', $2)) as rank
      FROM eva.emails
      WHERE owner_id = $1
        AND to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(body_plain,''))
            @@ to_tsquery('simple', $2)
        ${folderFilter}
      ORDER BY rank DESC, received_at DESC
      LIMIT $3
    `;

    const result = await query(sql, [ownerId, tsquery, limit]);
    return {
      ok: true,
      data: {
        query: q,
        count: result.rows.length,
        emails: result.rows,
      },
    };
  } catch (err) {
    return { ok: false, error: `gmail.search failed: ${err.message}` };
  }
}

export const gmailSearchSchema = {
  owner_id: { type: 'number', description: 'Owner ID (user)' },
  query: { type: 'string', description: 'Search query (full-text)', required: true },
  limit: { type: 'number', description: 'Max results (default 8, max 20)' },
  folder: { type: 'string', description: 'Filter: all | inbox | sent' },
};
