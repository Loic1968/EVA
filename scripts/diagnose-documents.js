#!/usr/bin/env node
/**
 * Diagnostic: vérifier les documents EVA en base.
 * Usage: EVA_DATABASE_URL="..." node scripts/diagnose-documents.js
 * ou: DATABASE_URL="..." node scripts/diagnose-documents.js
 */
require('dotenv').config();
const path = require('path');
const parentEnv = path.join(__dirname, '../../.env');
const evaEnv = path.join(__dirname, '../.env');
if (require('fs').existsSync(parentEnv)) require('dotenv').config({ path: parentEnv });
if (require('fs').existsSync(evaEnv)) require('dotenv').config({ path: evaEnv });

const { Pool } = require('pg');
const url = process.env.EVA_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set EVA_DATABASE_URL or DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: (url || '').includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function main() {
  const client = await pool.connect();
  try {
    // Compte par owner
    const byOwner = await client.query(`
      SELECT o.id as owner_id, o.email, COUNT(d.id) as doc_count
      FROM eva.owners o
      LEFT JOIN eva.documents d ON d.owner_id = o.id
      GROUP BY o.id, o.email
      ORDER BY doc_count DESC
    `);
    console.log('Documents par owner:');
    console.table(byOwner.rows);

    // Total
    const total = await client.query(
      'SELECT COUNT(*) as n FROM eva.documents'
    );
    console.log('\nTotal documents:', total.rows[0].n);

    // file_data vs storage_path (BYTEA: length() en bytes)
    const storage = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE file_data IS NOT NULL AND length(file_data) > 0) as with_file_data,
        COUNT(*) FILTER (WHERE file_data IS NULL OR length(file_data) = 0) as without_file_data
      FROM eva.documents
    `);
    console.log('\nStockage:', storage.rows[0]);

    // Derniers documents
    const hasContentCol = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'eva' AND table_name = 'documents' AND column_name = 'content_text'
    `);
    const recentCols = hasContentCol.rows.length > 0
      ? 'id, owner_id, filename, status, created_at, (file_data IS NOT NULL AND length(file_data) > 0) as has_file_data, (content_text IS NOT NULL AND length(content_text) > 0) as has_content, COALESCE(length(content_text), 0) as content_len'
      : 'id, owner_id, filename, status, created_at, (file_data IS NOT NULL AND length(file_data) > 0) as has_file_data';
    const recent = await client.query(`
      SELECT ${recentCols} FROM eva.documents ORDER BY created_at DESC LIMIT 5
    `);
    console.log('\n5 derniers documents (has_content = visible par EVA):');
    console.table(recent.rows);

    if (hasContentCol.rows.length === 0) {
      console.log('\n⚠️  Colonne content_text absente. Run: psql "$DATABASE_URL" -f eva/migrations/004_add_document_file_data.sql');
    }

    // Stats par status
    const byStatus = await client.query(`
      SELECT status, COUNT(*) as n FROM eva.documents GROUP BY status ORDER BY n DESC
    `);
    console.log('\nDocuments par status (indexed = EVA peut les voir):');
    console.table(byStatus.rows);

    const indexedCount = parseInt(byStatus.rows.find((r) => r.status === 'indexed')?.n || '0', 10);
    if (indexedCount === 0 && parseInt(total.rows[0].n, 10) > 0) {
      console.log('\n⚠️  Aucun document indexé. EVA ne voit pas les documents.');
      console.log('   → Vérifiez ANTHROPIC_API_KEY pour extraire les PDFs/images.');
      console.log('   → Page Documents > bouton "Re-index all" pour relancer.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
