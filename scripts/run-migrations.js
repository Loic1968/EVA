#!/usr/bin/env node
/**
 * Run EVA migrations using Node.js pg (no psql required).
 */
const path = require('path');
const fs = require('fs');
// Load .env files if they exist (local dev). Prod uses Render env vars.
const parentEnv = path.join(__dirname, '../../.env');
const evaEnv = path.join(__dirname, '../.env');
if (fs.existsSync(parentEnv)) require('dotenv').config({ path: parentEnv });
if (fs.existsSync(evaEnv)) require('dotenv').config({ path: evaEnv });
const { Pool } = require('pg');

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
