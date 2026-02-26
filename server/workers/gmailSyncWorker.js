/**
 * Gmail Background Sync Worker for EVA.
 * Runs every N minutes (configurable in Settings), syncs all active Gmail accounts.
 */
const db = require('../db');
const gmailSync = require('../services/gmailSync');

const DEFAULT_MINUTES = parseInt(process.env.GMAIL_SYNC_INTERVAL_MINUTES || '15', 10);

let isRunning = false;
let nextTimeout = null;

async function getSyncIntervalMinutes(ownerId) {
  try {
    const r = await db.query(
      `SELECT value FROM eva.settings WHERE owner_id = $1 AND key = 'sync_frequency_minutes'`,
      [ownerId]
    );
    let val = r.rows[0]?.value;
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val);
      } catch {
        val = null;
      }
    }
    const minutes = typeof val === 'object' && val?.minutes != null ? Number(val.minutes) : Number(val);
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : DEFAULT_MINUTES;
  } catch {
    return DEFAULT_MINUTES;
  }
}

async function runSync() {
  if (isRunning) {
    console.log('[Gmail Worker] Previous sync still running, skipping');
    return;
  }
  isRunning = true;
  let ownerId = null;

  try {
    const accounts = await db.query(
      `SELECT ga.id, ga.owner_id, ga.gmail_address
       FROM eva.gmail_accounts ga
       WHERE ga.sync_status NOT IN ('disabled')
         AND ga.refresh_token IS NOT NULL`
    );

    if (accounts.rows.length === 0) {
      return;
    }

    ownerId = accounts.rows[0].owner_id;
    const intervalMin = await getSyncIntervalMinutes(ownerId);

    console.log(`[Gmail Worker] Syncing ${accounts.rows.length} account(s) (every ${intervalMin} min)...`);

    for (const acct of accounts.rows) {
      try {
        const result = await gmailSync.syncEmails(acct.owner_id, acct.id);
        console.log(`[Gmail Worker] ${acct.gmail_address}: ${result.new} new emails`);

        // Log to audit
        await db.query(
          `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details)
           VALUES ($1, 'email_synced', 'gmail', $2)`,
          [acct.owner_id, JSON.stringify({ account: acct.gmail_address, ...result })]
        );
      } catch (err) {
        console.error(`[Gmail Worker] Sync failed for ${acct.gmail_address}:`, err.message);
        await db.query(
          `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details)
           VALUES ($1, 'email_sync_error', 'gmail', $2)`,
          [acct.owner_id, JSON.stringify({ account: acct.gmail_address, error: err.message })]
        );
      }
    }
  } catch (err) {
    console.error('[Gmail Worker] Fatal error:', err.message);
  } finally {
    isRunning = false;
    scheduleNext(ownerId);
  }
}

async function scheduleNext(ownerId) {
  if (nextTimeout) clearTimeout(nextTimeout);
  const intervalMin = ownerId != null ? await getSyncIntervalMinutes(ownerId) : DEFAULT_MINUTES;
  const ms = Math.max(1, intervalMin) * 60 * 1000;
  nextTimeout = setTimeout(runSync, ms);
}

function start() {
  console.log(`[Gmail Worker] Started — sync frequency configurable in Settings (default: ${DEFAULT_MINUTES} min)`);
  // Run first sync after 60 seconds (let server boot)
  setTimeout(runSync, 60 * 1000);
}

module.exports = { start, runSync };
