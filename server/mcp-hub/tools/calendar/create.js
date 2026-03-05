/**
 * calendar.create_event — Create a Google Calendar event via API.
 * Reads OAuth tokens from eva.gmail_accounts.
 */
import { query } from '../../core/db.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

async function refreshToken(refreshTok) {
  const clientId = process.env.EVA_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.EVA_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth credentials not configured');

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshTok, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  return res.json();
}

async function getAccessToken(ownerId) {
  const r = await query(
    `SELECT id, access_token, refresh_token, expires_at FROM eva.gmail_accounts
     WHERE owner_id = $1 AND sync_status = 'active' LIMIT 1`,
    [ownerId]
  );
  const acct = r.rows[0];
  if (!acct) throw new Error('No active Gmail account connected');

  if (acct.expires_at && new Date(acct.expires_at) < new Date()) {
    const tokens = await refreshToken(acct.refresh_token);
    await query(
      `UPDATE eva.gmail_accounts SET access_token = $1, expires_at = $2, token_updated_at = now() WHERE id = $3`,
      [tokens.access_token, new Date(Date.now() + (tokens.expires_in || 3600) * 1000), acct.id]
    );
    return tokens.access_token;
  }
  return acct.access_token;
}

export async function calendarCreateEvent(args, ctx) {
  const ownerId = args.owner_id ?? ctx.actor_id;
  const { title, start, end, description, location, all_day } = args;

  if (!ownerId) return { ok: false, error: 'owner_id required' };
  if (!title) return { ok: false, error: 'title required' };
  if (!start) return { ok: false, error: 'start (ISO date/datetime) required' };

  try {
    const accessToken = await getAccessToken(ownerId);

    const event = { summary: title };
    if (description) event.description = description;
    if (location) event.location = location;

    if (all_day) {
      event.start = { date: start.split('T')[0] };
      event.end = { date: (end || start).split('T')[0] };
    } else {
      event.start = { dateTime: start, timeZone: args.timezone || 'UTC' };
      event.end = { dateTime: end || new Date(new Date(start).getTime() + 3600000).toISOString(), timeZone: args.timezone || 'UTC' };
    }

    const res = await fetch(`${CALENDAR_API}/calendars/primary/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Calendar API ${res.status}: ${errText}` };
    }

    const data = await res.json();
    return {
      ok: true,
      data: {
        event_id: data.id,
        title: data.summary,
        start: data.start,
        end: data.end,
        html_link: data.htmlLink,
        status: 'created',
      },
    };
  } catch (err) {
    return { ok: false, error: `calendar.create_event failed: ${err.message}` };
  }
}

export const calendarCreateEventSchema = {
  owner_id: { type: 'number', description: 'Owner ID' },
  title: { type: 'string', description: 'Event title', required: true },
  start: { type: 'string', description: 'Start (ISO 8601)', required: true },
  end: { type: 'string', description: 'End (ISO 8601)' },
  description: { type: 'string', description: 'Event description' },
  location: { type: 'string', description: 'Event location' },
  all_day: { type: 'boolean', description: 'All-day event' },
  timezone: { type: 'string', description: 'Timezone (default UTC)' },
};
