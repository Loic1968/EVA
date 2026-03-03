/**
 * Google Calendar Sync Service for EVA.
 * Fetches events from Calendar API and stores them in eva.calendar_events.
 * Reuses the same OAuth token as Gmail (gmail_accounts).
 */
const db = require('../db');
const googleOAuth = require('./googleOAuth');

const CALENDAR_FETCH_DAYS = parseInt(process.env.CALENDAR_FETCH_DAYS || '60', 10);

/**
 * Sync calendar events for a given Gmail account.
 * Fetches from ALL calendars in the user's list (primary + work, shared, etc.).
 */
async function syncCalendar(ownerId, gmailAccountId) {
  const acctResult = await db.query(
    'SELECT id, access_token, refresh_token, expires_at FROM eva.gmail_accounts WHERE id = $1 AND owner_id = $2',
    [gmailAccountId, ownerId]
  );
  const acct = acctResult.rows[0];
  if (!acct) throw new Error(`Gmail account ${gmailAccountId} not found`);

  let accessToken = acct.access_token;
  if (acct.expires_at && new Date(acct.expires_at) < new Date()) {
    try {
      const newCreds = await googleOAuth.refreshAccessToken(acct.refresh_token);
      accessToken = newCreds.access_token;
      await db.query(
        `UPDATE eva.gmail_accounts
         SET access_token = $1, expires_at = $2, token_updated_at = now()
         WHERE id = $3`,
        [newCreds.access_token, new Date(newCreds.expiry_date), gmailAccountId]
      );
    } catch (err) {
      throw new Error(`Token refresh failed: ${err.message}`);
    }
  }

  const calendar = googleOAuth.getCalendarClient(accessToken, acct.refresh_token);

  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setDate(timeMin.getDate() - CALENDAR_FETCH_DAYS);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + CALENDAR_FETCH_DAYS);

  // 1. List all calendars the user has (primary + work, shared, etc.)
  let calendarIds = [{ id: 'primary' }];
  try {
    const listRes = await calendar.calendarList.list({ maxResults: 50 });
    const items = listRes.data.items || [];
    if (items.length > 0) {
      calendarIds = items.map((c) => ({ id: c.id, summary: c.summary || c.id }));
    }
  } catch (err) {
    console.warn('[Calendar Sync] calendarList.list failed, using primary only:', err.message);
  }
  console.log(`[Calendar Sync] Syncing ${calendarIds.length} calendar(s): ${calendarIds.map((c) => c.id).join(', ')}`);

  let totalSynced = 0;
  for (const cal of calendarIds) {
    let pageToken = null;
    do {
      try {
        const res = await calendar.events.list({
          calendarId: cal.id,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          maxResults: 250,
          pageToken: pageToken || undefined,
          orderBy: 'startTime',
          singleEvents: true,
        });

        const events = res.data.items || [];

        for (const ev of events) {
          if (!ev.id || ev.status === 'cancelled') continue;

          const start = ev.start?.dateTime || ev.start?.date;
          const end = ev.end?.dateTime || ev.end?.date;
          if (!start || !end) continue;

          // event_id unique per calendar: primary uses raw id (backward compat), others use prefix
          const eventId = cal.id === 'primary' ? ev.id : `${cal.id}__${ev.id}`.replace(/[^a-zA-Z0-9._-]/g, '_');

          await db.query(
            `INSERT INTO eva.calendar_events
             (owner_id, gmail_account_id, event_id, title, description, location, start_at, end_at, html_link, is_all_day, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
             ON CONFLICT (gmail_account_id, event_id) DO UPDATE SET
               title = EXCLUDED.title,
               description = EXCLUDED.description,
               location = EXCLUDED.location,
               start_at = EXCLUDED.start_at,
               end_at = EXCLUDED.end_at,
               html_link = EXCLUDED.html_link,
               is_all_day = EXCLUDED.is_all_day,
               synced_at = now()`,
            [
              ownerId,
              gmailAccountId,
              eventId,
              ev.summary || '(no title)',
              (ev.description || '').slice(0, 10000),
              ev.location || null,
              new Date(start),
              new Date(end),
              ev.htmlLink || null,
              !!ev.start?.date,
            ]
          );
          totalSynced++;
        }

        pageToken = res.data.nextPageToken;
      } catch (err) {
        console.warn(`[Calendar Sync] calendar ${cal.id} failed:`, err.message);
        break;
      }
    } while (pageToken);
  }

  console.log(`[Calendar Sync] Account ${gmailAccountId}: ${totalSynced} events synced`);
  return { synced: totalSynced };
}

/**
 * Sync calendar for all Gmail accounts of an owner.
 * Returns { synced, accounts, errors } so frontend can show what failed.
 */
async function syncCalendarForAllAccounts(ownerId) {
  const acctResult = await db.query(
    'SELECT id, gmail_address FROM eva.gmail_accounts WHERE owner_id = $1',
    [ownerId]
  );
  const accounts = acctResult.rows;
  if (accounts.length === 0) {
    return { synced: 0, accounts: 0, errors: ['No Gmail account connected. Connect Gmail in Data Sources first.'] };
  }

  let totalSynced = 0;
  const errors = [];
  for (const acct of accounts) {
    try {
      const r = await syncCalendar(ownerId, acct.id);
      totalSynced += r.synced;
    } catch (err) {
      const msg = err.message || String(err);
      const label = acct.gmail_address || `Account ${acct.id}`;
      console.warn(`[Calendar Sync] ${label} failed:`, msg);
      const isScopeError = /insufficient authentication scopes|Calendar API has not been used|Access Not Configured|403|scope|invalid_grant/i.test(msg);
      const hint = isScopeError
        ? ' → Disconnect and reconnect Gmail in Data Sources to grant calendar access.'
        : '';
      errors.push(`${label}: ${msg}${hint}`);
    }
  }
  return { synced: totalSynced, accounts: accounts.length, errors: errors.length > 0 ? errors : undefined };
}

/**
 * Create a calendar event in the primary calendar.
 * @param {number} ownerId
 * @param {number} [gmailAccountId] - defaults to first account
 * @param {object} params - summary, start (ISO), end (ISO), description?, location?
 */
async function createEvent(ownerId, params, gmailAccountId = null) {
  const acctResult = await db.query(
    gmailAccountId
      ? 'SELECT id, access_token, refresh_token, expires_at FROM eva.gmail_accounts WHERE id = $1 AND owner_id = $2'
      : 'SELECT id, access_token, refresh_token, expires_at FROM eva.gmail_accounts WHERE owner_id = $1 ORDER BY created_at ASC LIMIT 1',
    gmailAccountId ? [gmailAccountId, ownerId] : [ownerId]
  );
  const acct = acctResult.rows[0];
  if (!acct) throw new Error('No Gmail account connected. Connect Gmail in Data Sources first.');

  let accessToken = acct.access_token;
  if (acct.expires_at && new Date(acct.expires_at) < new Date()) {
    const newCreds = await googleOAuth.refreshAccessToken(acct.refresh_token);
    accessToken = newCreds.access_token;
    await db.query(
      'UPDATE eva.gmail_accounts SET access_token = $1, expires_at = $2, token_updated_at = now() WHERE id = $3',
      [newCreds.access_token, new Date(newCreds.expiry_date), acct.id]
    );
  }

  const calendar = googleOAuth.getCalendarClient(accessToken, acct.refresh_token);
  const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test((params.start || '').slice(0, 10));
  const resource = {
    summary: params.title || params.summary || '(no title)',
    description: params.description || '',
    location: params.location || '',
  };
  if (isAllDay) {
    resource.start = { date: params.start.slice(0, 10) };
    resource.end = { date: (params.end || params.start).slice(0, 10) };
  } else {
    resource.start = { dateTime: params.start };
    resource.end = { dateTime: params.end || params.start };
  }
  if (params.attendees && params.attendees.length > 0) {
    resource.attendees = params.attendees.map((e) => ({ email: typeof e === 'string' ? e : e.email || e }));
  }

  const res = await calendar.events.insert({ calendarId: 'primary', requestBody: resource });
  const ev = res.data;
  if (ev.id && ev.start && ev.end) {
    await db.query(
      `INSERT INTO eva.calendar_events (owner_id, gmail_account_id, event_id, title, description, location, start_at, end_at, html_link, is_all_day, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (gmail_account_id, event_id) DO UPDATE SET title = EXCLUDED.title, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, synced_at = now()`,
      [
        ownerId,
        acct.id,
        ev.id,
        ev.summary || '',
        ev.description || '',
        ev.location || null,
        new Date(ev.start.dateTime || ev.start.date),
        new Date(ev.end.dateTime || ev.end.date),
        ev.htmlLink || null,
        !!ev.start.date,
      ]
    );
  }
  return { id: ev.id, htmlLink: ev.htmlLink, summary: ev.summary };
}

/**
 * Update a calendar event by Google event_id or our DB id.
 */
async function updateEvent(ownerId, eventId, params) {
  const evRow = await db.query(
    'SELECT gmail_account_id, event_id FROM eva.calendar_events WHERE owner_id = $1 AND (event_id = $2 OR id = $2)',
    [ownerId, String(eventId)]
  );
  const row = evRow.rows[0];
  if (!row) throw new Error('Event not found');
  const gcalEventId = row.event_id;

  const acctResult = await db.query(
    'SELECT access_token, refresh_token, expires_at FROM eva.gmail_accounts WHERE id = $1 AND owner_id = $2',
    [row.gmail_account_id, ownerId]
  );
  const acct = acctResult.rows[0];
  if (!acct) throw new Error('Account not found');

  let accessToken = acct.access_token;
  if (acct.expires_at && new Date(acct.expires_at) < new Date()) {
    const newCreds = await googleOAuth.refreshAccessToken(acct.refresh_token);
    accessToken = newCreds.access_token;
    await db.query(
      'UPDATE eva.gmail_accounts SET access_token = $1, expires_at = $2 WHERE id = $3',
      [newCreds.access_token, new Date(newCreds.expiry_date), row.gmail_account_id]
    );
  }

  const calendar = googleOAuth.getCalendarClient(accessToken, acct.refresh_token);
  const existing = await calendar.events.get({ calendarId: 'primary', eventId: gcalEventId });
  const resource = { ...existing.data };
  if (params.title != null) resource.summary = params.title;
  if (params.description != null) resource.description = params.description;
  if (params.location != null) resource.location = params.location;
  if (params.start != null) {
    const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(String(params.start).slice(0, 10));
    resource.start = isAllDay ? { date: params.start.slice(0, 10) } : { dateTime: params.start };
  }
  if (params.end != null) {
    const isAllDay = resource.start?.date != null;
    resource.end = isAllDay ? { date: params.end.slice(0, 10) } : { dateTime: params.end };
  }

  const res = await calendar.events.patch({ calendarId: 'primary', eventId: gcalEventId, requestBody: resource });
  return { id: res.data.id, htmlLink: res.data.htmlLink };
}

/**
 * Resolve event identifier (our id or Google event_id) to Google event_id.
 */
async function resolveEventId(ownerId, eventId) {
  const r = await db.query(
    'SELECT event_id FROM eva.calendar_events WHERE owner_id = $1 AND (event_id = $2 OR id = $2)',
    [ownerId, String(eventId)]
  );
  return r.rows[0]?.event_id;
}

/**
 * Delete a calendar event by Google event_id or our DB id.
 * Handles events on primary and secondary calendars (event_id format: "calId__evId").
 */
async function deleteEvent(ownerId, eventId) {
  const storedId = await resolveEventId(ownerId, eventId);
  if (!storedId) throw new Error('Event not found');

  let calendarId = 'primary';
  let eventIdForApi = storedId;
  if (storedId.includes('__')) {
    const idx = storedId.indexOf('__');
    calendarId = storedId.slice(0, idx) || 'primary';
    eventIdForApi = storedId.slice(idx + 2);
  }

  const evRow = await db.query(
    'SELECT gmail_account_id FROM eva.calendar_events WHERE owner_id = $1 AND event_id = $2',
    [ownerId, storedId]
  );
  const acctResult = await db.query(
    'SELECT access_token, refresh_token, expires_at FROM eva.gmail_accounts WHERE id = $1 AND owner_id = $2',
    [evRow.rows[0].gmail_account_id, ownerId]
  );
  const acct = acctResult.rows[0];
  if (!acct) throw new Error('Account not found');

  let accessToken = acct.access_token;
  if (acct.expires_at && new Date(acct.expires_at) < new Date()) {
    const newCreds = await googleOAuth.refreshAccessToken(acct.refresh_token);
    accessToken = newCreds.access_token;
  }

  const calendar = googleOAuth.getCalendarClient(accessToken, acct.refresh_token);
  await calendar.events.delete({ calendarId, eventId: eventIdForApi });
  await db.query('DELETE FROM eva.calendar_events WHERE owner_id = $1 AND event_id = $2', [ownerId, storedId]);
  return { deleted: true };
}

/**
 * Get calendar events for an owner.
 * @param {number} ownerId
 * @param {number} limit
 * @param {number} daysAhead - used when from/to not provided
 * @param {number|null} gmailAccountId - filter by account (optional)
 * @param {string|null} fromStr - ISO date for range start (optional)
 * @param {string|null} toStr - ISO date for range end (optional)
 */
async function getUpcomingEvents(ownerId, limit = 15, daysAhead = 14, gmailAccountId = null, fromStr = null, toStr = null) {
  try {
    let from, to;
    if (fromStr && toStr) {
      from = new Date(fromStr);
      to = new Date(toStr);
    } else {
      from = new Date();
      to = new Date();
      to.setDate(to.getDate() + daysAhead);
    }

    const accountFilter = gmailAccountId ? ' AND ce.gmail_account_id = $5' : '';
    const params = [ownerId, from, to, Math.min(limit, 200)];
    if (gmailAccountId) params.push(gmailAccountId);

    const r = await db.query(
      `SELECT ce.id, ce.title, ce.start_at, ce.end_at, ce.location, ce.is_all_day,
              ce.gmail_account_id, ga.gmail_address
       FROM eva.calendar_events ce
       JOIN eva.gmail_accounts ga ON ga.id = ce.gmail_account_id AND ga.owner_id = ce.owner_id
       WHERE ce.owner_id = $1 AND ce.start_at >= $2 AND ce.start_at <= $3${accountFilter}
       ORDER BY ce.start_at ASC
       LIMIT $4`,
      params
    );
    return r.rows;
  } catch (err) {
    if (/relation "eva\.calendar_events" does not exist/i.test(String(err.message))) {
      return [];
    }
    throw err;
  }
}

/**
 * Search calendar events by query (title/description). Used for flight questions.
 * Time window: [-daysBack, +daysAhead] from now.
 * @param {number} ownerId
 * @param {string} query - search terms (e.g. "flight OR e-ticket OR Shanghai OR PVG")
 * @param {number} daysBack - default 30
 * @param {number} daysAhead - default 90
 * @param {number} limit - default 20
 */
async function searchCalendarEvents(ownerId, query, daysBack = 30, daysAhead = 90, limit = 20) {
  try {
    const from = new Date();
    from.setDate(from.getDate() - daysBack);
    const to = new Date();
    to.setDate(to.getDate() + daysAhead);

    const words = (query || '')
      .split(/\s+/)
      .map((w) => w.trim().replace(/[%_\\]/g, (c) => '\\' + c))
      .filter((w) => w.length >= 2)
      .slice(0, 10);

    const conds = words.length > 0
      ? words.map((_, i) => `(ce.title ILIKE $${i + 5} OR ce.description ILIKE $${i + 5})`).join(' OR ')
      : '1=1';
    const params = [ownerId, from, to, Math.min(limit, 50)];
    words.forEach((w) => params.push('%' + w + '%'));

    const r = await db.query(
      `SELECT ce.id, ce.event_id, ce.title, ce.description, ce.start_at, ce.end_at, ce.location, ce.is_all_day,
              ce.gmail_account_id, ga.gmail_address
       FROM eva.calendar_events ce
       JOIN eva.gmail_accounts ga ON ga.id = ce.gmail_account_id AND ga.owner_id = ce.owner_id
       WHERE ce.owner_id = $1 AND ce.start_at >= $2 AND ce.start_at <= $3 AND (${conds})
       ORDER BY ce.start_at ASC
       LIMIT $4`,
      params
    );
    return r.rows;
  } catch (err) {
    if (/relation "eva\.calendar_events" does not exist/i.test(String(err.message))) {
      return [];
    }
    throw err;
  }
}

module.exports = {
  syncCalendar,
  syncCalendarForAllAccounts,
  getUpcomingEvents,
  searchCalendarEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  resolveEventId,
};
