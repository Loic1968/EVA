/**
 * EVA Auth: signup, login, forgot password, reset password, passkey
 */
const express = require('express');
const router = express.Router();
const webauthnRouter = require('./webauthn');

router.use('/webauthn', webauthnRouter);
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const rateLimit = require('express-rate-limit');

const JWT_SECRET = (process.env.EVA_JWT_SECRET || process.env.JWT_SECRET || 'eva-dev-secret-change-in-prod').trim();
const JWT_EXPIRY = process.env.EVA_JWT_EXPIRY || '7d';
const FRONTEND_URL = process.env.EVA_FRONTEND_URL || process.env.EVA_ALLOWED_ORIGINS?.split(',')[0] || 'https://eva.halisoft.biz';
const isProd = process.env.NODE_ENV === 'production';

// Log SMTP status at module load (EVA server startup)
const _smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
const _smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASSWORD;
if (_smtpUser && _smtpPass) {
  console.log('[EVA Auth] SMTP configured for password reset (user:', _smtpUser.replace(/(.{2}).*(@.*)/, '$1***$2'), ')');
} else {
  console.log('[EVA Auth] SMTP not configured — reset links logged to console only. Set SMTP_USER+SMTP_PASS or EMAIL_USER+EMAIL_PASSWORD.');
}

// GET /api/auth/config — whether login is required (public)
router.get('/config', (req, res) => {
  const skip = process.env.EVA_SKIP_AUTH === 'true';
  res.json({ requireAuth: !skip });
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: isProd ? 10 : 50, message: { error: 'Too many login attempts' } });
const signupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: isProd ? 5 : 20, message: { error: 'Too many signups' } });
const forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: isProd ? 5 : 20, message: { error: 'Too many reset requests' } });

function validatePassword(pwd) {
  if (!pwd || pwd.length < 8) return 'Password must be 8+ characters';
  if (!/[A-Z]/.test(pwd)) return 'Password must contain 1 uppercase letter';
  if (!/[0-9]/.test(pwd)) return 'Password must contain 1 number';
  if (!/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(pwd)) return 'Password must contain 1 special character';
  return null;
}

// POST /api/auth/signup
router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { email, password, display_name } = req.body || {};
    const e = (email || '').trim().toLowerCase();
    if (!e || !e.includes('@')) return res.status(400).json({ error: 'Valid email required' });
    const err = validatePassword(password);
    if (err) return res.status(400).json({ error: err });

    const existing = await db.getOwnerByEmail(e);
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const r = await db.query(
      `INSERT INTO eva.owners (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name`,
      [e, (display_name || '').trim() || null, hash]
    );
    const owner = r.rows[0];
    const token = jwt.sign({ ownerId: owner.id, email: owner.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.status(201).json({ token, user: { id: owner.id, email: owner.email, display_name: owner.display_name } });
  } catch (e) {
    console.error('[EVA Auth] signup:', e.message);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const e = (email || '').trim().toLowerCase();
    if (!e || !password) return res.status(400).json({ error: 'Email and password required' });

    const r = await db.query('SELECT id, email, display_name, password_hash FROM eva.owners WHERE email = $1', [e]);
    const owner = r.rows[0];
    if (!owner) return res.status(401).json({ error: 'Invalid email or password' });
    if (!owner.password_hash) return res.status(401).json({ error: 'Account has no password. Use forgot password to set one.' });

    const ok = await bcrypt.compare(password, owner.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ ownerId: owner.id, email: owner.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.json({ token, user: { id: owner.id, email: owner.email, display_name: owner.display_name } });
  } catch (e) {
    console.error('[EVA Auth] login:', e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    const e = (email || '').trim().toLowerCase();
    if (!e) return res.status(400).json({ error: 'Email required' });

    const r = await db.query('SELECT id FROM eva.owners WHERE email = $1', [e]);
    if (r.rows.length === 0) {
      return res.json({ exists: false, message: 'Email not registered' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.query(
      'INSERT INTO eva.password_reset_tokens (email, token_hash, expires_at) VALUES ($1, $2, $3)',
      [e, tokenHash, expiresAt]
    );

    const resetUrl = `${FRONTEND_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(e)}`;

    let emailSent = false;
    let emailError = null;
    const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
    const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASSWORD;

    if (!smtpUser || !smtpPass) {
      emailError = 'Email service not configured (SMTP missing)';
      console.log('[EVA Auth] Reset link (no SMTP):', resetUrl);
    } else {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
          port: Number(process.env.SMTP_PORT || process.env.EMAIL_SMTP_PORT || 587),
          secure: (process.env.SMTP_SECURE || '').toLowerCase() === 'true',
          auth: { user: smtpUser, pass: smtpPass },
        });
        await transporter.sendMail({
          from: `"EVA" <${smtpUser}>`,
          to: e,
          subject: 'EVA — Password reset',
          text: `Click to reset: ${resetUrl}\n\nThis link expires in 1 hour.`,
          html: `<p>Click to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
        });
        emailSent = true;
        console.log('[EVA Auth] Password reset email sent to', e);
      } catch (mailErr) {
        const code = mailErr.code || '';
        const msg = (mailErr.message || '').toLowerCase();
        if (code === 'EAUTH' || msg.includes('invalid login') || msg.includes('authentication')) {
          emailError = 'SMTP authentication failed (check Gmail app password)';
        } else if (msg.includes('self-signed') || msg.includes('certificate')) {
          emailError = 'SMTP certificate error';
        } else if (msg.includes('timeout') || msg.includes('econnrefused')) {
          emailError = 'SMTP connection failed';
        } else {
          emailError = mailErr.message ? `${mailErr.message}`.slice(0, 100) : 'Email send failed';
        }
        console.error('[EVA Auth] Email send failed:', mailErr.message, '- code:', code);
      }
    }

    res.json({
      exists: true,
      emailSent,
      emailError: emailSent ? null : emailError,
      message: emailSent ? 'Email sent' : 'Email not sent',
      resetUrl,
    });
  } catch (e) {
    console.error('[EVA Auth] forgot:', e.message);
    res.status(500).json({ error: 'Request failed' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', forgotLimiter, async (req, res) => {
  try {
    const { token, email, password } = req.body || {};
    const e = (email || '').trim().toLowerCase();
    if (!e || !token) return res.status(400).json({ error: 'Email and token required' });
    const err = validatePassword(password);
    if (err) return res.status(400).json({ error: err });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const r = await db.query(
      `SELECT email FROM eva.password_reset_tokens
       WHERE email = $1 AND token_hash = $2 AND expires_at > now()`,
      [e, tokenHash]
    );
    if (r.rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset link' });

    const hash = await bcrypt.hash(password, 12);
    await db.query('UPDATE eva.owners SET password_hash = $1, updated_at = now() WHERE email = $2', [hash, e]);
    await db.query('DELETE FROM eva.password_reset_tokens WHERE email = $1', [e]);

    const ownerR = await db.query('SELECT id, email, display_name FROM eva.owners WHERE email = $1', [e]);
    const owner = ownerR.rows[0];
    const jwtToken = jwt.sign({ ownerId: owner.id, email: owner.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.json({ token: jwtToken, user: { id: owner.id, email: owner.email, display_name: owner.display_name } });
  } catch (e) {
    console.error('[EVA Auth] reset:', e.message);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// GET /api/auth/me — verify token, return user
router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const r = await db.query('SELECT id, email, display_name FROM eva.owners WHERE id = $1', [decoded.ownerId]);
    if (!r.rows[0]) return res.status(401).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
