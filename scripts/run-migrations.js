#!/usr/bin/env node
/**
 * Run EVA migrations using Node.js pg (no psql required).
 */
const path = require('path');
// Load parent .env first (has real DATABASE_URL), then eva overrides
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs = require('fs');

const DATABASE_URL = process.env.EVA_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL or EVA_DATABASE_URL required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const migrationsDir = require('path').join(__dirname, '../migrations');
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

async function run() {
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(require('path').join(migrationsDir, file), 'utf8');
      console.log(`Running ${file}...`);
      await client.query(sql);
      console.log(`  ✓ ${file}`);
    }
    console.log('All migrations completed.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
