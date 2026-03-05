/**
 * gmail.recent — Get most recent synced emails for a user.
 */
import { query } from '../../core/db.js';

export async function gmailRecent(args, ctx) {
  const ownerId = args.owner_id ?? ctx.actor_id;
  const limit = Math.max(1, Math.min(30, Number(args.limit) || 10));
  const previewChars = Math.max(200, Math.min(5000, Number(args.preview_chars) || 1200));

  if (!ownerId) return { ok: false, error: 'owner_id required' };

  try {
    const sql = `
      SELECT id, gmail_account_id, thread_id, from_email, from_name, to_emails,
             subject, snippet, left(body_plain, $2) as body_preview,
             received_at, labels, is_read, is_starred, has_attachments
      FROM eva.emails
      WHERE owner_id = $1
      ORDER BY received_at DESC
      LIMIT $3
    `;
    const result = await query(sql, [ownerId, previewChars, limit]);
    return {
      ok: true,
      data: {
        count: result.rows.length,
        emails: result.rows,
      },
    };
  } catch (err) {
    return { ok: false, error: `gmail.recent failed: ${err.message}` };
  }
}

export const gmailRecentSchema = {
  owner_id: { type: 'number', description: 'Owner ID (user)' },
  limit: { type: 'number', description: 'Max results (default 10, max 30)' },
  preview_chars: { type: 'number', description: 'Body preview length (default 1200)' },
};
