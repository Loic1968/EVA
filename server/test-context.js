#!/usr/bin/env node
/**
 * Test script: vérifie que Documents, Emails, Calendar sont bien injectés
 * pour une question type "quand est mon vol pour Shanghai ?"
 *
 * Usage: cd eva && node server/test-context.js [ownerId|email]
       node server/test-context.js list   → liste les owners
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') }); // parent .env

const userMessage = 'quand est mon vol pour Shanghai ?';

async function main() {
  const arg = process.argv[2];
  if (arg === 'list') {
    const db = require('./db');
    const r = await db.query('SELECT id, email, display_name FROM eva.owners ORDER BY id');
    console.log('Owners:', r.rows.length);
    r.rows.forEach((o) => console.log(`  ${o.id}: ${o.email}`));
    return;
  }
  let ownerId;
  if (arg && /^\d+$/.test(arg)) {
    ownerId = parseInt(arg, 10);
  } else if (arg && arg.includes('@')) {
    const db = require('./db');
    const owner = await db.getOwnerByEmail(arg);
    if (!owner) {
      console.error('Owner non trouvé pour:', arg);
      process.exit(1);
    }
    ownerId = owner.id;
    console.log('Owner trouvé:', owner.email, '(id=' + owner.id + ')');
  } else {
    ownerId = parseInt(arg || '1', 10);
  }
  console.log('\n=== Test contextBuilder ===');
  console.log('ownerId:', ownerId);
  console.log('userMessage:', userMessage);
  console.log('EVA_SMART_CONTEXT:', process.env.EVA_SMART_CONTEXT);
  console.log('');

  const { buildContext } = require('./contextBuilder');

  try {
    const { context } = await buildContext({ ownerId, userMessage, history: [] });

    if (!context) {
      console.log('⚠️  Context vide');
      return;
    }

    const hasDocs = /## Documents/.test(context) && !/## Documents \(vide\)/.test(context);
    const hasEmails = /## Emails/.test(context);
    const hasCalendar = /## Calendar/.test(context) && !/## Calendar \(vide\)/.test(context);

    console.log('--- Présence des sections ---');
    console.log('Documents (avec contenu):', hasDocs);
    console.log('Emails:', hasEmails);
    console.log('Calendar (avec contenu):', hasCalendar);
    console.log('');

    if (hasDocs) {
      const docMatch = context.match(/## Documents[^\n]*\n([\s\S]*?)(?=\n## |$)/);
      if (docMatch) {
        const preview = docMatch[1].slice(0, 800);
        console.log('--- Aperçu Documents ---');
        console.log(preview);
        console.log('...');
      }
    } else if (/## Documents \(vide\)/.test(context)) {
      console.log('--- Documents: section vide (pas de docs trouvés) ---');
    }

    if (hasEmails) {
      const emailMatch = context.match(/## Emails[^\n]*\n([\s\S]*?)(?=\n## |$)/);
      if (emailMatch) {
        const preview = emailMatch[1].slice(0, 600);
        console.log('\n--- Aperçu Emails ---');
        console.log(preview);
        console.log('...');
      }
    }

    if (hasCalendar) {
      const calMatch = context.match(/## Calendar[^\n]*\n([\s\S]*?)(?=\n## |$)/);
      if (calMatch) {
        console.log('\n--- Aperçu Calendar ---');
        console.log(calMatch[1].slice(0, 500));
      }
    }

    // Vérif directe DB
    console.log('\n--- Vérif directe DB ---');
    const db = require('./db');
    const docRes = await db.query(
      `SELECT id, filename, LENGTH(content_text) as len, status
       FROM eva.documents
       WHERE owner_id = $1 AND content_text IS NOT NULL AND content_text != ''
       ORDER BY created_at DESC LIMIT 5`,
      [ownerId]
    );
    console.log('Documents en DB:', docRes.rows.length);
    docRes.rows.forEach((r, i) => console.log(`  ${i + 1}. ${r.filename} (${r.len} chars, status=${r.status})`));

    const emailRes = await db.query(
      `SELECT COUNT(*) as n FROM eva.emails WHERE owner_id = $1`,
      [ownerId]
    );
    console.log('Emails en DB:', emailRes.rows[0]?.n || 0);

    const shanghaiEmails = await db.query(
      `SELECT id, subject, LEFT(body_preview, 80) as preview FROM eva.emails
       WHERE owner_id = $1 AND (subject ILIKE '%shanghai%' OR body_preview ILIKE '%shanghai%')
       LIMIT 3`,
      [ownerId]
    );
    if (shanghaiEmails.rows.length > 0) {
      console.log('Emails mentionnant Shanghai:', shanghaiEmails.rows.length);
      shanghaiEmails.rows.forEach((r) => console.log(`  - ${r.subject}`));
    }

    const calRes = await db.query(
      `SELECT COUNT(*) as n FROM eva.calendar_events WHERE owner_id = $1`,
      [ownerId]
    );
    console.log('Events calendar en DB:', calRes.rows[0]?.n || 0);

    console.log('\n=== Fin ===\n');
  } catch (err) {
    console.error('Erreur:', err.message);
    process.exit(1);
  }
}

main();
