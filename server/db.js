/**
 * EVA DB – same PostgreSQL as Halisoft, eva schema.
 * Uses DATABASE_URL from env (same as main app) and sets search_path to eva for EVA tables.
 */
const { Pool } = require('pg');
require('dotenv').config();

const { DATABASE_URL, EVA_DATABASE_URL } = process.env;

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = EVA_DATABASE_URL || DATABASE_URL;
    if (!connectionString) {
      throw new Error('EVA: DATABASE_URL or EVA_DATABASE_URL must be set');
    }
    const isProduction = process.env.NODE_ENV === 'production';
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

/**
 * Run query in eva schema. For raw SQL that uses eva.* tables, search_path is set per client.
 */
async function query(text, params = []) {
  const client = await getPool().connect();
  try {
    await client.query('SET search_path TO eva, public');
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

async function getOwnerByEmail(email) {
  const r = await query(
    'SELECT id, email, display_name FROM eva.owners WHERE email = $1',
    [email]
  );
  return r.rows[0] || null;
}

async function getOrCreateOwner(email, displayName = null) {
  let owner = await getOwnerByEmail(email);
  if (!owner) {
    const r = await query(
      `INSERT INTO eva.owners (email, display_name) VALUES ($1, $2)
       RETURNING id, email, display_name`,
      [email, displayName || email]
    );
    owner = r.rows[0];
  }
  return owner;
}

module.exports = {
  getPool,
  query,
  getOwnerByEmail,
  getOrCreateOwner,
};
