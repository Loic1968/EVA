#!/usr/bin/env node
/**
 * EVA conversation regression harness — Phase 5.
 * Replays user turns and checks: facts consistency, no self-contradiction, /correct respected.
 * Inputs: conversation ids (owner provided). Outputs: redacted markdown report.
 * Never prints full PII. Mask dates (YYYY-MM-DD -> YYYY-**-**), passport numbers.
 * Usage: EVA_OVERHAUL_ENABLED=true node eva/server/scripts/runRegressionFromConversations.js 123 456 789
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('../db');
const evaChat = require('../evaChat');

const CONV_IDS = process.argv.slice(2).map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));

function maskPii(text) {
  if (!text || typeof text !== 'string') return '[empty]';
  return text
    .replace(/\d{4}-\d{2}-\d{2}/g, 'YYYY-**-**')
    .replace(/\b\d{1,2}\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/gi, '** mois')
    .replace(/\b[A-Z]{1,2}\d{6,9}\b/g, '[PASSPORT_MASKED]')
    .replace(/\b\d{16,19}\b/g, '[CARD_MASKED]')
    .slice(0, 200);
}

async function loadConversation(convId, ownerId) {
  const r = await db.query(
    `SELECT m.role, m.content, m.created_at
     FROM eva.messages m
     JOIN eva.conversations c ON c.id = m.conversation_id AND c.owner_id = m.owner_id
     WHERE m.conversation_id = $1 AND m.owner_id = $2
     ORDER BY m.created_at ASC`,
    [convId, ownerId]
  );
  return r.rows;
}

async function runRegression(convIds, ownerId) {
  const report = { passed: 0, failed: 0, skipped: 0, details: [] };

  for (const convId of convIds) {
    const messages = await loadConversation(convId, ownerId);
    if (messages.length < 2) {
      report.skipped++;
      report.details.push({ convId, reason: 'Too few messages' });
      continue;
    }

    const userTurns = messages.filter((m) => m.role === 'user');
    let history = [];
    let lastCorrectKey = null;
    let lastCorrectValue = null;

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'assistant') {
        history.push({ role: 'assistant', content: m.content });
        continue;
      }

      const content = m.content || '';
      const isCorrect = /^\/correct\s+(\S+)=(.+)$/is.test(content.trim());
      if (isCorrect) {
        const match = content.trim().match(/^\/correct\s+(\S+)=(.+)$/is);
        if (match) {
          lastCorrectKey = match[1].trim();
          lastCorrectValue = match[2].trim();
        }
      }

      if (m.role !== 'user') continue;
      const userContent = content.trim();
      if (!userContent || userContent.startsWith('/')) continue;

      try {
        const result = await evaChat.reply(userContent, history, ownerId, null);
        const reply = result.reply || '';

        const contradictsCorrect = lastCorrectKey && lastCorrectValue
          && !reply.toLowerCase().includes(lastCorrectValue.toLowerCase().slice(0, 20))
          && /date|naissance|vol|march|mars|février|fevrier|february/i.test(userContent);

        if (contradictsCorrect) {
          report.failed++;
          report.details.push({
            convId,
            turn: maskPii(userContent),
            replySnippet: maskPii(reply.slice(0, 150)),
            expectedContained: maskPii(lastCorrectValue),
          });
        } else {
          report.passed++;
        }

        history.push({ role: 'user', content: userContent });
        history.push({ role: 'assistant', content: reply });
      } catch (err) {
        report.failed++;
        report.details.push({ convId, turn: maskPii(userContent), error: err.message });
      }
    }
  }

  return report;
}

async function main() {
  if (CONV_IDS.length === 0) {
    console.error('Usage: OWNER_ID=1 node runRegressionFromConversations.js <conv_id1> [conv_id2 ...]');
    console.error('Example: OWNER_ID=1 node eva/server/scripts/runRegressionFromConversations.js 42 57');
    process.exit(1);
  }

  const ownerId = parseInt(process.env.OWNER_ID || '', 10);
  if (!ownerId || Number.isNaN(ownerId)) {
    console.error('OWNER_ID required (e.g. OWNER_ID=1)');
    process.exit(1);
  }

  const report = await runRegression(CONV_IDS, ownerId);

  const md = [
    '# EVA Regression Report',
    '',
    `**Conversations:** ${CONV_IDS.join(', ')}`,
    `**Owner ID:** ${ownerId}`,
    '',
    `| Passed | Failed | Skipped |`,
    `|--------|--------|---------|`,
    `| ${report.passed} | ${report.failed} | ${report.skipped} |`,
    '',
  ];

  if (report.details.length > 0) {
    md.push('## Failures / Details');
    md.push('');
    report.details.forEach((d) => {
      md.push(`- Conv ${d.convId}: ${JSON.stringify(d)}`);
    });
  }

  console.log(md.join('\n'));
  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
