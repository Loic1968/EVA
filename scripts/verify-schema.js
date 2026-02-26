#!/usr/bin/env node
/**
 * Verify EVA schema - list tables and check push_subscriptions exists.
 * Usage: node eva/scripts/verify-schema.js [--prod]
 */
const path = require('path');
const fs = require('fs');
const parentEnv = path.join(__dirname, '../../.env');
const evaEnv = path.join(__dirname, '../.env');
if (fs.existsSync(parentEnv)) require('dotenv').config({ path: parentEnv });
if (fs.existsSync(evaEnv)) require('dotenv').config({ path: evaEnv });
const { Pool } = require('pg');

const useProd = process.argv.includes('--prod');
const DATABASE_URL = useProd
  ? (process.env.EVA_DATABASE_URL_PROD || process.env.PROD_DATABASE_URL)
  : (process.env.EVA_DATABASE_URL || process.env.DATABASE_URL);
if (!DATABASE_URL) {
  console.error(useProd ? 'EVA_DATABASE_URL_PROD required' : 'DATABASE_URL required');
  process.exit(1);
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});
(async () => {
  const r = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'eva' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );
  const tables = r.rows.map((x) => x.table_name);
  console.log('EVA tables (' + (useProd ? 'PROD' : 'LOCAL') + '):', tables.join(', '));
  const hasPush = tables.includes('push_subscriptions');
  console.log('push_subscriptions:', hasPush ? '✓' : '✗ MISSING');
  await pool.end();
  process.exit(hasPush ? 0 : 1);
})();
