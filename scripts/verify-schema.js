#!/usr/bin/env node
/**
 * Compare EVA schema between dev and prod.
 * Usage:
 *   EVA_DATABASE_URL_PROD=postgres://... node scripts/verify-schema.js
 *   (DATABASE_URL or EVA_DATABASE_URL = dev)
 */
const path = require('path');
const fs = require('fs');
const parentEnv = path.join(__dirname, '../../.env');
const evaEnv = path.join(__dirname, '../.env');
if (fs.existsSync(parentEnv)) require('dotenv').config({ path: parentEnv });
if (fs.existsSync(evaEnv)) require('dotenv').config({ path: evaEnv });

const { Pool } = require('pg');

const devUrl = process.env.EVA_DATABASE_URL || process.env.DATABASE_URL;
const prodUrl = process.env.EVA_DATABASE_URL_PROD;

if (!devUrl) {
  console.error('DATABASE_URL or EVA_DATABASE_URL required for dev');
  process.exit(1);
}
if (!prodUrl) {
  console.error('EVA_DATABASE_URL_PROD required for prod comparison');
  console.error('Usage: EVA_DATABASE_URL_PROD=postgres://... node scripts/verify-schema.js');
  process.exit(1);
}

async function getSchema(pool, label) {
  const client = await pool.connect();
  try {
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'eva' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const out = { tables: [], columns: {}, indexes: [] };
    for (const r of tables.rows) {
      const t = r.table_name;
      out.tables.push(t);
      const cols = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'eva' AND table_name = $1
        ORDER BY ordinal_position
      `, [t]);
      out.columns[t] = cols.rows.map(c => `${c.column_name} ${c.data_type} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    }
    const idx = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'eva'
      ORDER BY indexname
    `);
    out.indexes = idx.rows.map(r => r.indexdef);
    return out;
  } finally {
    client.release();
  }
}

function diffSchema(dev, prod) {
  const diffs = [];
  const devTables = new Set(dev.tables);
  const prodTables = new Set(prod.tables);
  for (const t of prodTables) {
    if (!devTables.has(t)) diffs.push(`[PROD ONLY] Table eva.${t}`);
  }
  for (const t of devTables) {
    if (!prodTables.has(t)) diffs.push(`[DEV ONLY] Table eva.${t}`);
  }
  for (const t of devTables) {
    if (!prodTables.has(t)) continue;
    const dc = (dev.columns[t] || []).join(' | ');
    const pc = (prod.columns[t] || []).join(' | ');
    if (dc !== pc) {
      diffs.push(`[DIFF] eva.${t} columns:`);
      diffs.push(`  DEV:  ${dc || '(none)'}`);
      diffs.push(`  PROD: ${pc || '(none)'}`);
    }
  }
  const devIdx = new Set(dev.indexes);
  const prodIdx = new Set(prod.indexes);
  for (const i of prodIdx) {
    if (!devIdx.has(i)) diffs.push(`[PROD ONLY] Index: ${i.substring(0, 100)}`);
  }
  for (const i of devIdx) {
    if (!prodIdx.has(i)) diffs.push(`[DEV ONLY] Index: ${i.substring(0, 100)}`);
  }
  return diffs;
}

async function run() {
  const devPool = new Pool({ connectionString: devUrl });
  const prodPool = new Pool({ connectionString: prodUrl });
  try {
    console.log('Fetching DEV schema (eva)...');
    const dev = await getSchema(devPool, 'dev');
    console.log(`  Tables: ${dev.tables.join(', ')}`);

    console.log('Fetching PROD schema (eva)...');
    const prod = await getSchema(prodPool, 'prod');
    console.log(`  Tables: ${prod.tables.join(', ')}`);

    const diffs = diffSchema(dev, prod);
    if (diffs.length === 0) {
      console.log('\n✓ Schemas match.');
    } else {
      console.log('\n✗ Differences found:');
      diffs.forEach(d => console.log(d));
      process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await devPool.end();
    await prodPool.end();
  }
}

run();
