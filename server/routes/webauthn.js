/**
 * EVA WebAuthn / Passkey — register and login with passkeys
 */
const express = require('express');
const router = express.Router();
const { verifyAuth } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const db = require('../db');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const JWT_SECRET = (process.env.EVA_JWT_SECRET || process.env.JWT_SECRET || 'eva-dev-secret-change-in-prod').trim();
const JWT_EXPIRY = process.env.EVA_JWT_EXPIRY || '7d';
const RP_NAME = 'EVA';
const RP_ID = process.env.EVA_WEBAUTHN_RP_ID || (process.env.NODE_ENV === 'production' ? 'eva.halisoft.biz' : 'localhost');
const ORIGIN = process.env.EVA_FRONTEND_URL || process.env.EVA_ALLOWED_ORIGINS?.split(',')[0] || (process.env.NODE_ENV === 'production' ? 'https://eva.halisoft.biz' : 'http://localhost:5173');

// In-memory challenge store (5 min TTL). For multi-instance use Redis.
const challenges = new Map();
function setChallenge(key, val) {
  challenges.set(key, { ...val, at: Date.now() });
}
function getChallenge(key) {
  const v = challenges.get(key);
  if (!v || Date.now() - v.at > 5 * 60 * 1000) return null;
  challenges.delete(key);
  return v;
}
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of challenges.entries()) {
    if (v.at < cutoff) challenges.delete(k);
  }
}, 60 * 1000);

// POST /api/auth/webauthn/register/options — requires auth
router.post('/register/options', verifyAuth, async (req, res) => {
  try {
    const ownerId = req.ownerId;
    if (!ownerId) return res.status(401).json({ error: 'Sign in required to add passkey' });

    const owner = (await db.query('SELECT id, email FROM eva.owners WHERE id = $1', [ownerId])).rows[0];
    if (!owner) return res.status(401).json({ error: 'User not found' });

    const existing = await db.query(
      'SELECT credential_id FROM eva.webauthn_credentials WHERE owner_id = $1',
      [ownerId]
    );
    const excludeCredentials = existing.rows.map((r) => ({
      id: r.credential_id,
      transports: ['internal', 'hybrid'],
    }));

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID === 'localhost' ? 'localhost' : RP_ID,
      userID: Buffer.from(String(owner.id), 'utf8'),
      userName: owner.email,
      userDisplayName: owner.email.split('@')[0],
      attestationType: 'none',
      excludeCredentials: excludeCredentials.length ? excludeCredentials : undefined,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    setChallenge(options.challenge, { ownerId, type: 'reg' });
    res.json(options);
  } catch (e) {
    console.error('[EVA WebAuthn] register options:', e.message);
    res.status(500).json({ error: 'Failed to generate options' });
  }
});

// POST /api/auth/webauthn/register/verify — requires auth
router.post('/register/verify', verifyAuth, async (req, res) => {
  try {
    const ownerId = req.ownerId;
    if (!ownerId) return res.status(401).json({ error: 'Sign in required' });

    const { credential } = req.body || {};
    if (!credential || !credential.response?.clientDataJSON) return res.status(400).json({ error: 'Credential required' });

    const clientData = JSON.parse(Buffer.from(credential.response.clientDataJSON, 'base64url').toString());
    const usedChallenge = clientData.challenge;
    const stored = getChallenge(usedChallenge);
    if (!stored || stored.ownerId !== ownerId || stored.type !== 'reg') {
      return res.status(400).json({ error: 'Challenge expired or invalid' });
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: usedChallenge,
      expectedOrigin: ORIGIN.split(',')[0].trim(),
      expectedRPID: RP_ID === 'localhost' ? 'localhost' : RP_ID,
    });

    if (!verification.verified) return res.status(400).json({ error: 'Verification failed' });

    const { credentialID, credentialPublicKey, counter, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const credIdB64 = Buffer.from(credentialID).toString('base64url');

    await db.query(
      `INSERT INTO eva.webauthn_credentials (owner_id, credential_id, public_key, counter, device_type, backed_up)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (credential_id) DO UPDATE SET public_key = $3, counter = $4`,
      [ownerId, credIdB64, Buffer.from(credentialPublicKey), counter, credentialDeviceType || 'singleDevice', credentialBackedUp || false]
    );

    res.json({ ok: true, message: 'Passkey added' });
  } catch (e) {
    console.error('[EVA WebAuthn] register verify:', e.message);
    res.status(500).json({ error: e.message || 'Verification failed' });
  }
});

// POST /api/auth/webauthn/login/options
router.post('/login/options', async (req, res) => {
  try {
    const { email } = req.body || {};
    const e = (email || '').trim().toLowerCase();
    if (!e) return res.status(400).json({ error: 'Email required' });

    const owner = (await db.query('SELECT id, email FROM eva.owners WHERE email = $1', [e])).rows[0];
    if (!owner) {
      return res.json({ options: null, message: 'No account with that email' });
    }

    const creds = await db.query(
      'SELECT credential_id FROM eva.webauthn_credentials WHERE owner_id = $1',
      [owner.id]
    );

    const allowCredentials = creds.rows.map((r) => ({
      id: r.credential_id,
      transports: ['internal', 'hybrid'],
    }));

    if (allowCredentials.length === 0) {
      return res.json({ options: null, message: 'No passkey registered for this account' });
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID === 'localhost' ? 'localhost' : RP_ID,
      allowCredentials: allowCredentials.map((c) => ({ ...c, id: c.id })),
      userVerification: 'preferred',
    });

    setChallenge(options.challenge, { ownerId: owner.id, email: owner.email, type: 'auth' });
    res.json({ options });
  } catch (e) {
    console.error('[EVA WebAuthn] login options:', e.message);
    res.status(500).json({ error: 'Failed to generate options' });
  }
});

// POST /api/auth/webauthn/login/verify
router.post('/login/verify', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential || !credential.response?.clientDataJSON) return res.status(400).json({ error: 'Credential required' });

    const clientData = JSON.parse(Buffer.from(credential.response.clientDataJSON, 'base64url').toString());
    const expectedChallenge = clientData.challenge;
    const stored = getChallenge(expectedChallenge);
    if (!stored || stored.type !== 'auth') return res.status(400).json({ error: 'Challenge expired' });

    const credId = credential.id || credential.rawId;
    const credIdB64 = typeof credId === 'string' ? credId : Buffer.from(credId).toString('base64url');

    const row = (await db.query(
      `SELECT w.owner_id, w.public_key, w.counter, o.email, o.display_name
       FROM eva.webauthn_credentials w
       JOIN eva.owners o ON o.id = w.owner_id
       WHERE w.credential_id = $1 AND w.owner_id = $2`,
      [credIdB64, stored.ownerId]
    )).rows[0];

    if (!row) return res.status(401).json({ error: 'Invalid passkey' });

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: ORIGIN.split(',')[0].trim(),
      expectedRPID: RP_ID === 'localhost' ? 'localhost' : RP_ID,
      authenticator: {
        credentialID: Buffer.from(credIdB64, 'base64url'),
        credentialPublicKey: row.public_key instanceof Buffer ? new Uint8Array(row.public_key) : row.public_key,
        counter: Number(row.counter),
      },
    });

    if (!verification.verified) return res.status(401).json({ error: 'Verification failed' });

    await db.query('UPDATE eva.webauthn_credentials SET counter = $1 WHERE credential_id = $2', [
      verification.authenticationInfo.newCounter,
      credIdB64,
    ]);

    const token = jwt.sign({ ownerId: row.owner_id, email: row.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.json({
      token,
      user: { id: row.owner_id, email: row.email, display_name: row.display_name },
    });
  } catch (e) {
    console.error('[EVA WebAuthn] login verify:', e.message);
    res.status(500).json({ error: e.message || 'Verification failed' });
  }
});

module.exports = router;
