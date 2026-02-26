/**
 * EVA Notification Worker – sends reminders based on calendar and other events.
 * Runs every 5 minutes, checks upcoming events, sends email reminders.
 */
const db = require('../db');
const calendarSync = require('../services/calendarSync');
const gmailSend = require('../services/gmailSend');
const pushNotificationService = require('../services/pushNotificationService');
const { getKillSwitch, getNotificationPreferences } = require('../services/settingsService');

const INTERVAL_MS = 5 * 60 * 1000; // 5 min
const WINDOW_MIN = 2; // consider event if start is within ±WINDOW_MIN of the lead time

let isRunning = false;
let nextTimeout = null;

async function alreadySent(ownerId, sourceType, sourceId, leadMinutes) {
  try {
    const r = await db.query(
      'SELECT 1 FROM eva.notification_log WHERE owner_id = $1 AND source_type = $2 AND source_id = $3 AND lead_minutes = $4',
      [ownerId, sourceType, sourceId, leadMinutes]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function markSent(ownerId, sourceType, sourceId, leadMinutes, sentTo) {
  try {
    await db.query(
      `INSERT INTO eva.notification_log (owner_id, source_type, source_id, lead_minutes, sent_to)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_id, source_type, source_id, lead_minutes) DO NOTHING`,
      [ownerId, sourceType, sourceId, leadMinutes, sentTo]
    );
  } catch (err) {
    console.warn('[Notification Worker] markSent failed:', err.message);
  }
}

function formatLead(leadMin) {
  if (leadMin < 60) return `${leadMin} min`;
  if (leadMin < 1440) return `${Math.round(leadMin / 60)} h`;
  return `${Math.round(leadMin / 1440)} day`;
}

function formatEventTime(startAt) {
  const d = new Date(startAt);
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function runNotifications() {
  if (isRunning) return;
  isRunning = true;

  try {
    const owners = await db.query(
      `SELECT o.id, o.email,
              (SELECT ga.gmail_address FROM eva.gmail_accounts ga
               WHERE ga.owner_id = o.id AND ga.sync_status = 'active' ORDER BY ga.id LIMIT 1) AS notify_email
       FROM eva.owners o
       WHERE EXISTS (SELECT 1 FROM eva.gmail_accounts g WHERE g.owner_id = o.id AND g.sync_status = 'active')`
    );

    for (const owner of owners.rows) {
      try {
        const killOn = await getKillSwitch(owner.id);
        if (killOn) continue;

        const prefs = await getNotificationPreferences(owner.id);
        if (!prefs.enabled) continue;

        const events = await calendarSync.getUpcomingEvents(owner.id, 50, 2);
        if (events.length === 0) continue;

        const now = new Date();
        const sent = [];

        for (const leadMin of prefs.leadMinutes) {
          const targetStart = new Date(now.getTime() + leadMin * 60 * 1000);
          const windowStart = new Date(targetStart.getTime() - WINDOW_MIN * 60 * 1000);
          const windowEnd = new Date(targetStart.getTime() + WINDOW_MIN * 60 * 1000);

          for (const ev of events) {
            const startAt = new Date(ev.start_at);
            if (startAt < windowStart || startAt > windowEnd) continue;

            const sourceId = String(ev.id);
            if (await alreadySent(owner.id, 'calendar', sourceId, leadMin)) continue;

            const subject = `EVA Reminder: ${ev.title || 'Event'} in ${formatLead(leadMin)}`;
            const body = [
              `Hi,`,
              ``,
              `Reminder: ${ev.title || '(no title)'}`,
              `When: ${formatEventTime(ev.start_at)}`,
              ev.location ? `Where: ${ev.location}` : null,
              ev.description ? `\n${(ev.description || '').slice(0, 500)}` : null,
              ev.html_link ? `\nLink: ${ev.html_link}` : null,
              ``,
              `— EVA`,
            ]
              .filter(Boolean)
              .join('\n');

            const toEmail = owner.notify_email || owner.email;
            try {
              const pushResult = await pushNotificationService.sendToOwner(owner.id, {
                title: `Reminder: ${ev.title || 'Event'} in ${formatLead(leadMin)}`,
                body: `${formatEventTime(ev.start_at)}${ev.location ? ` @ ${ev.location}` : ''}`,
                data: { type: 'calendar', event_id: sourceId, url: '/calendar' },
              });
              if (pushResult.sent === 0) {
                await gmailSend.sendEmail(owner.id, { to: toEmail, subject, body });
              }
              await markSent(owner.id, 'calendar', sourceId, leadMin, toEmail);
              sent.push({ event: ev.title, lead: formatLead(leadMin) });
            } catch (err) {
              console.warn(`[Notification Worker] Send failed for owner ${owner.id}:`, err.message);
            }
          }
        }

        if (sent.length > 0) {
          await db.query(
            `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details)
             VALUES ($1, 'notification_sent', 'email', $2)`,
            [owner.id, JSON.stringify({ count: sent.length, reminders: sent })]
          );
          console.log(`[Notification Worker] Owner ${owner.id}: sent ${sent.length} reminder(s)`);
        }
      } catch (err) {
        console.warn(`[Notification Worker] Owner ${owner.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Notification Worker] Fatal:', err.message);
  } finally {
    isRunning = false;
    nextTimeout = setTimeout(runNotifications, INTERVAL_MS);
  }
}

function start() {
  console.log('[Notification Worker] Started — calendar reminders every 5 min');
  setTimeout(runNotifications, 90 * 1000);
}

function stop() {
  if (nextTimeout) clearTimeout(nextTimeout);
}

module.exports = { start, stop, runNotifications };
