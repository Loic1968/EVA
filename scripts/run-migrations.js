#!/usr/bin/env node
/**
 * Run EVA migrations in order.
 * Usage: DATABASE_URL=... node scripts/run-migrations.js
 * Called automatically during Render deploy (releaseCommand).
 */
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

require('dotenv').config();
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const DATABASE_URL = process.env.EVA_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[Migrations] DATABASE_URL not set, skipping');
  process.exit(0);
}

const migrationsDir = path.resolve(__dirname, '../migrations');
const files = fs.readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

async function run() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  const client = await pool.connect();
  try {
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`[Migrations] Running ${file}...`);
      await client.query(sql);
      console.log(`[Migrations] ✓ ${file}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[Migrations] Error:', err.message);
  process.exit(1);
});
