/**
 * EVA Email Importance Worker – notifies user when an important email arrives.
 * Priority levels:
 *   - gmail_only: Gmail IMPORTANT label only
 *   - gmail_and_ai: Gmail IMPORTANT + AI analysis for unread emails without the label
 */
const db = require('../db');
const gmailSend = require('../services/gmailSend');
const pushNotificationService = require('../services/pushNotificationService');
const { getKillSwitch, getEmailImportancePreferences } = require('../services/settingsService');

const INTERVAL_MS = 10 * 60 * 1000; // 10 min
const LOOKBACK_MINUTES = 90; // consider emails received in last 90 min (covers sync gaps)
const AI_BATCH_SIZE = 5; // max unread emails to run AI on per owner

let isRunning = false;
let nextTimeout = null;

async function alreadyNotified(ownerId, messageId) {
  try {
    const r = await db.query(
      `SELECT 1 FROM eva.notification_log
       WHERE owner_id = $1 AND source_type = 'email_importance' AND source_id = $2 AND lead_minutes = 0`,
      [ownerId, String(messageId)]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function markNotified(ownerId, messageId, sentTo) {
  try {
    await db.query(
      `INSERT INTO eva.notification_log (owner_id, source_type, source_id, lead_minutes, sent_to)
       VALUES ($1, 'email_importance', $2, 0, $3)
       ON CONFLICT (owner_id, source_type, source_id, lead_minutes) DO NOTHING`,
      [ownerId, String(messageId), sentTo]
    );
  } catch (err) {
    console.warn('[Email Importance] markNotified failed:', err.message);
  }
}

/**
 * Call Claude to classify if email is important/urgent from subject + snippet.
 * Returns true if important, false otherwise.
 */
async function classifyEmailImportance(subject, snippet) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) return false;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: key.trim() });
    const text = `Subject: ${(subject || '').slice(0, 200)}\nSnippet: ${(snippet || '').slice(0, 500)}`;
    const res = await client.messages.create({
      model: process.env.EVA_CHAT_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 20,
      messages: [{ role: 'user', content: `Is this email important or urgent? Reply only YES or NO.\n\n${text}` }],
    });
    const reply = res.content?.find((b) => b.type === 'text')?.text?.trim().toUpperCase() || '';
    return reply.startsWith('YES');
  } catch (err) {
    console.warn('[Email Importance] AI classification failed:', err.message);
    return false;
  }
}

async function runEmailImportanceCheck() {
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

    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);

    for (const owner of owners.rows) {
      try {
        const killOn = await getKillSwitch(owner.id);
        if (killOn) continue;

        const prefs = await getEmailImportancePreferences(owner.id);
        if (!prefs.enabled) continue;

        // 1. Get unread emails from last LOOKBACK_MINUTES with Gmail IMPORTANT label
        let importantEmails = [];
        const importantResult = await db.query(
          `SELECT id, message_id, from_email, from_name, subject, snippet, received_at
           FROM eva.emails
           WHERE owner_id = $1
             AND is_read = false
             AND received_at >= $2
             AND labels @> ARRAY['IMPORTANT']::text[]
           ORDER BY received_at DESC
           LIMIT 20`,
          [owner.id, since]
        );
        importantEmails = importantResult.rows;

        // 2. If gmail_and_ai: also check unread emails WITHOUT IMPORTANT, run AI on top N
        if (prefs.priorityLevel === 'gmail_and_ai') {
          const unreadNoImportant = await db.query(
            `SELECT id, message_id, from_email, from_name, subject, snippet, received_at
             FROM eva.emails
             WHERE owner_id = $1
               AND is_read = false
               AND received_at >= $2
               AND (labels IS NULL OR NOT (labels @> ARRAY['IMPORTANT']::text[]))
             ORDER BY received_at DESC
             LIMIT $3`,
            [owner.id, since, AI_BATCH_SIZE]
          );
          for (const em of unreadNoImportant.rows) {
            const isImportant = await classifyEmailImportance(em.subject, em.snippet);
            if (isImportant && !importantEmails.some((e) => e.message_id === em.message_id)) {
              importantEmails.push(em);
            }
          }
        }

        const toEmail = owner.notify_email || owner.email;
        let sent = 0;

        for (const em of importantEmails) {
          if (await alreadyNotified(owner.id, em.message_id)) continue;

          const dateFmt = new Date(em.received_at).toLocaleString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
          const subject = `EVA: Important email from ${em.from_name || em.from_email} — ${(em.subject || '').slice(0, 50)}`;
          const body = [
            `Hi,`,
            ``,
            `EVA detected an important email:`,
            ``,
            `From: ${em.from_name ? `${em.from_name} <${em.from_email}>` : em.from_email}`,
            `Subject: ${em.subject || '(no subject)'}`,
            `Received: ${dateFmt}`,
            ``,
            em.snippet ? `Preview: ${em.snippet.slice(0, 300)}...` : null,
            ``,
            `— EVA`,
          ]
            .filter(Boolean)
            .join('\n');

          try {
            const pushResult = await pushNotificationService.sendToOwner(owner.id, {
              title: 'Important email',
              body: `From ${em.from_name || em.from_email}: ${(em.subject || '').slice(0, 60)}`,
              data: { type: 'email_importance', message_id: em.message_id, url: '/chat' },
            });
            if (pushResult.sent === 0) {
              await gmailSend.sendEmail(owner.id, { to: toEmail, subject, body });
            }
            await markNotified(owner.id, em.message_id, toEmail);
            sent++;
          } catch (err) {
            console.warn(`[Email Importance] Send failed for owner ${owner.id}:`, err.message);
          }
        }

        if (sent > 0) {
          await db.query(
            `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details)
             VALUES ($1, 'email_importance_notification', 'email', $2)`,
            [owner.id, JSON.stringify({ count: sent, priorityLevel: prefs.priorityLevel })]
          );
          console.log(`[Email Importance] Owner ${owner.id}: sent ${sent} notification(s)`);
        }
      } catch (err) {
        console.warn(`[Email Importance] Owner ${owner.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Email Importance] Fatal:', err.message);
  } finally {
    isRunning = false;
    nextTimeout = setTimeout(runEmailImportanceCheck, INTERVAL_MS);
  }
}

function start() {
  console.log('[Email Importance] Started — check every 10 min (gmail_only or gmail_and_ai)');
  setTimeout(runEmailImportanceCheck, 2 * 60 * 1000); // first run after 2 min
}

function stop() {
  if (nextTimeout) clearTimeout(nextTimeout);
}

module.exports = { start, stop, runEmailImportanceCheck };
