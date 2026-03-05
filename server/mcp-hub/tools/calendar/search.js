/**
 * calendar.search — Search calendar events by title/description.
 */
import { query } from '../../core/db.js';

export async function calendarSearch(args, ctx) {
  const ownerId = args.owner_id ?? ctx.actor_id;
  const q = (args.query || '').trim();
  const daysBefore = Math.max(0, Math.min(365, Number(args.days_before) || 30));
  const daysAfter = Math.max(0, Math.min(365, Number(args.days_after) || 90));
  const limit = Math.max(1, Math.min(30, Number(args.limit) || 20));

  if (!ownerId) return { ok: false, error: 'owner_id required' };
  if (!q) return { ok: false, error: 'query required' };

  try {
    // ILIKE search on title and description
    const pattern = `%${q}%`;
    const sql = `
      SELECT ce.id, ce.event_id, ce.title, ce.description, ce.location,
             ce.start_at, ce.end_at, ce.is_all_day, ce.html_link,
             ga.gmail_address
      FROM eva.calendar_events ce
      JOIN eva.gmail_accounts ga ON ga.id = ce.gmail_account_id
      WHERE ce.owner_id = $1
        AND ce.start_at >= now() - ($2 || ' days')::interval
        AND ce.start_at <= now() + ($3 || ' days')::interval
        AND (ce.title ILIKE $4 OR coalesce(ce.description, '') ILIKE $4)
      ORDER BY ce.start_at ASC
      LIMIT $5
    `;
    const result = await query(sql, [ownerId, String(daysBefore), String(daysAfter), pattern, limit]);
    return {
      ok: true,
      data: {
        query: q,
        count: result.rows.length,
        events: result.rows,
      },
    };
  } catch (err) {
    return { ok: false, error: `calendar.search failed: ${err.message}` };
  }
}

export const calendarSearchSchema = {
  owner_id: { type: 'number', description: 'Owner ID (user)' },
  query: { type: 'string', description: 'Search text (title/description)', required: true },
  days_before: { type: 'number', description: 'Look back N days (default 30)' },
  days_after: { type: 'number', description: 'Look ahead N days (default 90)' },
  limit: { type: 'number', description: 'Max results (default 20)' },
};
