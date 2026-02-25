#!/usr/bin/env node
/**
 * Diagnostic: test calendar sync and surface real errors
 * Run: cd eva && node scripts/diagnose-calendar-sync.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const db = require('../server/db');

async function main() {
  console.log('=== EVA Calendar Sync Diagnostic ===\n');

  // 1. Check env
  const clientId = process.env.EVA_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.EVA_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  console.log('EVA_GOOGLE_CLIENT_ID:', clientId ? `${clientId.slice(0, 20)}...` : 'MISSING');
  console.log('EVA_GOOGLE_CLIENT_SECRET:', clientSecret ? 'SET' : 'MISSING');

  // 2. Get owner
  const ownerEmail = process.env.EVA_OWNER_EMAIL || 'loic@halisoft.biz';
  const ownerRow = await db.query('SELECT id, email FROM eva.owners WHERE email = $1', [ownerEmail]);
  const owner = ownerRow.rows[0];
  if (!owner) {
    console.log('\n✗ No owner found for', ownerEmail);
    process.exit(1);
  }
  console.log('\nOwner:', owner.email, '(id:', owner.id, ')');

  // 3. Get Gmail accounts
  const acctRows = await db.query(
    'SELECT id, gmail_address, token_scope, expires_at FROM eva.gmail_accounts WHERE owner_id = $1',
    [owner.id]
  );
  if (acctRows.rows.length === 0) {
    console.log('\n✗ No Gmail accounts connected. Connect Gmail in Data Sources first.');
    process.exit(1);
  }
  console.log('\nGmail accounts:', acctRows.rows.map((a) => `${a.gmail_address} (id:${a.id})`).join(', '));
  for (const a of acctRows.rows) {
    console.log('  - scope:', (a.token_scope || 'not stored').slice(0, 80) + '...');
    console.log('  - expires_at:', a.expires_at);
  }

  // 4. Try Calendar API directly
  console.log('\n--- Testing Calendar API ---');
  const calendarSync = require('../server/services/calendarSync');
  try {
    const result = await calendarSync.syncCalendarForAllAccounts(owner.id);
    console.log('\n✓ Sync completed:', result);
    if (result.errors && result.errors.length > 0) {
      console.log('\n⚠ Errors:', result.errors);
    }
  } catch (err) {
    console.log('\n✗ Sync failed:', err.message);
    console.log('Full error:', err);
  }

  // 5. Count events in DB
  const countRow = await db.query(
    'SELECT COUNT(*) as n FROM eva.calendar_events WHERE owner_id = $1',
    [owner.id]
  );
  console.log('\nEvents in DB:', countRow.rows[0].n);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
