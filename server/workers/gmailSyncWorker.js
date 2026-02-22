/**
 * Gmail Background Sync Worker for EVA.
 * Runs every N minutes, syncs all active Gmail accounts.
 */
const db = require('../db');
const gmailSync = require('../services/gmailSync');

const SYNC_INTERVAL = parseInt(process.env.GMAIL_SYNC_INTERVAL_MINUTES || '30', 10) * 60 * 1000;

let isRunning = false;

async function runSync() {
  if (isRunning) {
    console.log('[Gmail Worker] Previous sync still running, skipping');
    return;
  }
  isRunning = true;

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

    console.log(`[Gmail Worker] Syncing ${accounts.rows.length} account(s)...`);

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
  }
}

function start() {
  console.log(`[Gmail Worker] Started — syncing every ${SYNC_INTERVAL / 60000} minutes`);
  // Run first sync after 60 seconds (let server boot)
  setTimeout(runSync, 60 * 1000);
  // Then run on interval
  setInterval(runSync, SYNC_INTERVAL);
}

module.exports = { start, runSync };
