#!/usr/bin/env node
/**
 * Compare EVA schema (eva.* tables) between local and production DB.
 * Usage:
 *   DATABASE_URL=... EVA_DATABASE_URL_PROD=... node eva/scripts/compare-schema.js
 * Or set both in .env (EVA_DATABASE_URL_PROD = Render connection string).
 */
const path = require('path');
const fs = require('fs');
const parentEnv = path.join(__dirname, '../../.env');
const evaEnv = path.join(__dirname, '../.env');
if (fs.existsSync(parentEnv)) require('dotenv').config({ path: parentEnv });
if (fs.existsSync(evaEnv)) require('dotenv').config({ path: evaEnv });
const { Pool } = require('pg');

const LOCAL_URL = process.env.EVA_DATABASE_URL || process.env.DATABASE_URL;
const PROD_URL = process.env.EVA_DATABASE_URL_PROD || process.env.PROD_DATABASE_URL;

if (!LOCAL_URL) {
  console.error('Set DATABASE_URL or EVA_DATABASE_URL for local DB');
  process.exit(1);
}
if (!PROD_URL) {
  console.error('Set EVA_DATABASE_URL_PROD for production DB (copy from Render → DB → Connection string)');
  process.exit(1);
}

async function getSchema(connString, label) {
  const isLocal = (connString || '').match(/localhost|127\.0\.0\.1/);
  const ssl = isLocal ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: connString, ssl });
  const client = await pool.connect();
  const schema = { tables: [], columns: {} };
  try {
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eva' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    schema.tables = tables.rows.map((r) => r.table_name);
    for (const t of schema.tables) {
      const cols = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'eva' AND table_name = $1 ORDER BY ordinal_position`,
        [t]
      );
      schema.columns[t] = cols.rows.map((r) => `${r.column_name}:${r.data_type}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
  return schema;
}

function diff(a, b) {
  const onlyInA = a.filter((x) => !b.includes(x));
  const onlyInB = b.filter((x) => !a.includes(x));
  const common = a.filter((x) => b.includes(x));
  return { onlyInA, onlyInB, common };
}

async function main() {
  console.log('Fetching LOCAL schema...');
  const local = await getSchema(LOCAL_URL, 'LOCAL');
  console.log('Fetching PROD schema...');
  const prod = await getSchema(PROD_URL, 'PROD');

  const tableDiff = diff(local.tables, prod.tables);
  let hasDiff = false;

  console.log('\n=== EVA schema comparison ===\n');

  if (tableDiff.onlyInB.length) {
    hasDiff = true;
    console.log('Tables ONLY in PROD:', tableDiff.onlyInB.join(', ') || '(none)');
  }
  if (tableDiff.onlyInA.length) {
    hasDiff = true;
    console.log('Tables ONLY in LOCAL (missing in PROD):', tableDiff.onlyInA.join(', ') || '(none)');
  }

  const colDiffs = [];
  for (const t of tableDiff.common) {
    const l = (local.columns[t] || []).sort().join(',');
    const p = (prod.columns[t] || []).sort().join(',');
    if (l !== p) {
      hasDiff = true;
      colDiffs.push(t);
    }
  }
  if (colDiffs.length) {
    console.log('Tables with different columns:', colDiffs.join(', '));
    for (const t of colDiffs) {
      const lOnly = (local.columns[t] || []).filter((c) => !(prod.columns[t] || []).includes(c));
      const pOnly = (prod.columns[t] || []).filter((c) => !(local.columns[t] || []).includes(c));
      if (lOnly.length) console.log(`  ${t} - only in LOCAL:`, lOnly.join(', '));
      if (pOnly.length) console.log(`  ${t} - only in PROD:`, pOnly.join(', '));
    }
  }

  if (!hasDiff) {
    console.log('OK — Local and Prod schemas match.');
  } else {
    console.log('\n⚠️  Schemas differ. Run migrations on prod or sync manually.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
