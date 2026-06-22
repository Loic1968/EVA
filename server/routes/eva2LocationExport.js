/**
 * Eva 2 VPS — pull dernière position GPS depuis EVA 1 (token HMAC partagé).
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const locationService = require('../services/locationService');

const router = express.Router();

function verifyExportToken(token) {
  const secret = (process.env.EVA2_SSO_SECRET || '').trim();
  if (!secret || !token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return false;
    if (data.purpose !== 'location-export') return false;
    return true;
  } catch {
    return false;
  }
}

router.get('/location-export', async (req, res) => {
  if (!verifyExportToken(req.query.token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const email = process.env.EVA_OWNER_EMAIL || 'loic@halisoft.biz';
    const row = (await db.query('SELECT id FROM eva.owners WHERE email = $1 LIMIT 1', [email])).rows[0];
    if (!row) return res.status(404).json({ error: 'owner not found' });
    const location = await locationService.getLocation(row.id);
    return res.json({ ok: true, location: location || null });
  } catch (e) {
    console.error('[EVA] location-export:', e.message);
    return res.status(500).json({ error: 'export failed' });
  }
});

module.exports = router;
