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
 * Fetches events from primary calendar for the last N days and next N days.
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

  let newCount = 0;
  let pageToken = null;

  do {
    const res = await calendar.events.list({
      calendarId: 'primary',
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

      const result = await db.query(
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
          ev.id,
          ev.summary || '(no title)',
          (ev.description || '').slice(0, 10000),
          ev.location || null,
          new Date(start),
          new Date(end),
          ev.htmlLink || null,
          !!ev.start?.date,
        ]
      );
      if (result.rowCount > 0) newCount++;
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return { synced: newCount };
}

/**
 * Sync calendar for all Gmail accounts of an owner.
 */
async function syncCalendarForAllAccounts(ownerId) {
  const acctResult = await db.query(
    'SELECT id FROM eva.gmail_accounts WHERE owner_id = $1',
    [ownerId]
  );
  const accounts = acctResult.rows;
  if (accounts.length === 0) {
    return { synced: 0, accounts: 0 };
  }

  let totalSynced = 0;
  for (const acct of accounts) {
    try {
      const r = await syncCalendar(ownerId, acct.id);
      totalSynced += r.synced;
    } catch (err) {
      console.warn(`[Calendar Sync] Account ${acct.id} failed:`, err.message);
    }
  }
  return { synced: totalSynced, accounts: accounts.length };
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
 */
async function deleteEvent(ownerId, eventId) {
  const gcalId = await resolveEventId(ownerId, eventId);
  if (!gcalId) throw new Error('Event not found');

  const evRow = await db.query(
    'SELECT gmail_account_id FROM eva.calendar_events WHERE owner_id = $1 AND event_id = $2',
    [ownerId, gcalId]
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
  await calendar.events.delete({ calendarId: 'primary', eventId: gcalId });
  await db.query('DELETE FROM eva.calendar_events WHERE owner_id = $1 AND event_id = $2', [ownerId, gcalId]);
  return { deleted: true };
}

/**
 * Get upcoming calendar events for an owner (for EVA context injection).
 */
async function getUpcomingEvents(ownerId, limit = 15, daysAhead = 14) {
  try {
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + daysAhead);

    const r = await db.query(
      `SELECT id, title, start_at, end_at, location, is_all_day, gmail_account_id
       FROM eva.calendar_events
       WHERE owner_id = $1 AND start_at >= $2 AND start_at <= $3
       ORDER BY start_at ASC
       LIMIT $4`,
      [ownerId, from, to, Math.min(limit, 50)]
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
  createEvent,
  updateEvent,
  deleteEvent,
  resolveEventId,
};
