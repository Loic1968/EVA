/**
 * calendar.events — Get upcoming calendar events for a user.
 */
import { query } from '../../core/db.js';

export async function calendarEvents(args, ctx) {
  const ownerId = args.owner_id ?? ctx.actor_id;
  const days = Math.max(1, Math.min(90, Number(args.days) || 14));
  const limit = Math.max(1, Math.min(50, Number(args.limit) || 15));

  if (!ownerId) return { ok: false, error: 'owner_id required' };

  try {
    const sql = `
      SELECT ce.id, ce.event_id, ce.title, ce.description, ce.location,
             ce.start_at, ce.end_at, ce.is_all_day, ce.html_link,
             ga.gmail_address
      FROM eva.calendar_events ce
      JOIN eva.gmail_accounts ga ON ga.id = ce.gmail_account_id
      WHERE ce.owner_id = $1
        AND ce.start_at >= now()
        AND ce.start_at <= now() + ($2 || ' days')::interval
      ORDER BY ce.start_at ASC
      LIMIT $3
    `;
    const result = await query(sql, [ownerId, String(days), limit]);
    return {
      ok: true,
      data: {
        count: result.rows.length,
        days_ahead: days,
        events: result.rows,
      },
    };
  } catch (err) {
    return { ok: false, error: `calendar.events failed: ${err.message}` };
  }
}

export const calendarEventsSchema = {
  owner_id: { type: 'number', description: 'Owner ID (user)' },
  days: { type: 'number', description: 'Days ahead to look (default 14, max 90)' },
  limit: { type: 'number', description: 'Max events (default 15, max 50)' },
};
