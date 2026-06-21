/**
 * Eva 2 (OpenClaw VPS) — lien SSO depuis EVA 1 authentifié
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { verifyAuth } = require('../middleware/auth');

router.use(verifyAuth);

function createSsoToken(email) {
  const secret = (process.env.EVA2_SSO_SECRET || '').trim();
  if (!secret) return null;
  const exp = Date.now() + 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

router.get('/access', (req, res) => {
  const base = (process.env.EVA2_PUBLIC_URL || 'https://eva-vps.halisoft.biz').replace(/\/$/, '');
  const email = req.user?.email || process.env.EVA_OWNER_EMAIL || 'loic@halisoft.biz';
  const token = createSsoToken(email);
  if (!token) {
    return res.json({
      url: base,
      sso: false,
      telegram: '@Halisoft2bot',
    });
  }
  res.json({
    url: `${base}/auth/sso?token=${encodeURIComponent(token)}`,
    sso: true,
    telegram: '@Halisoft2bot',
  });
});

module.exports = router;
