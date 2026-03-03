/**
 * Gmail OAuth callback — PUBLIC route (no verifyAuth).
 * Google redirects here with ?code&state. state = ownerId.
 */
const db = require('../db');
const googleOAuth = require('../services/googleOAuth');

async function gmailCallback(req, res, next) {
  try {
    const base = (process.env.EVA_FRONTEND_URL || process.env.EVA_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
    if (!googleOAuth.hasCredentials()) {
      return res.redirect(base + '/sources?error=' + encodeURIComponent('Gmail OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to eva/.env'));
    }
    const { code, state } = req.query;
    if (!code) return res.status(400).json({ error: 'Authorization code missing' });

    const ownerId = state ? parseInt(state, 10) : null;
    if (!ownerId || isNaN(ownerId)) {
      return res.redirect(base + '/login?error=' + encodeURIComponent('Invalid OAuth state. Please log in and try again.'));
    }

    const tokens = await googleOAuth.exchangeCode(code);
    if (!tokens || !tokens.access_token) {
      return res.redirect(base + '/sources?error=' + encodeURIComponent('Token exchange failed'));
    }

    const gmailAddress = await googleOAuth.getUserEmail(tokens.access_token, tokens.refresh_token);

    await db.query(
      `INSERT INTO eva.gmail_accounts (owner_id, gmail_address, access_token, refresh_token, token_scope, expires_at, sync_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (owner_id, gmail_address) DO UPDATE SET
         access_token = $3, refresh_token = COALESCE($4, eva.gmail_accounts.refresh_token),
         token_scope = $5, expires_at = $6, sync_status = 'pending',
         token_updated_at = now(), error_message = NULL`,
      [
        ownerId, gmailAddress, tokens.access_token,
        tokens.refresh_token || null, tokens.scope || null,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      ]
    );

    const configJson = JSON.stringify({ connected_at: new Date().toISOString() });
    const existing = await db.query(
      `SELECT id FROM eva.data_sources WHERE owner_id = $1 AND source_type = 'gmail' AND external_id = $2`,
      [ownerId, gmailAddress]
    );
    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE eva.data_sources SET config = $1 WHERE owner_id = $2 AND source_type = 'gmail' AND external_id = $3`,
        [configJson, ownerId, gmailAddress]
      );
    } else {
      await db.query(
        `INSERT INTO eva.data_sources (owner_id, source_type, external_id, config) VALUES ($1, 'gmail', $2, $3)`,
        [ownerId, gmailAddress, configJson]
      );
    }

    await db.query(
      `INSERT INTO eva.audit_logs (owner_id, action_type, channel, details) VALUES ($1, 'gmail_connected', 'gmail', $2)`,
      [ownerId, JSON.stringify({ gmail_address: gmailAddress })]
    );

    res.redirect(base + '/sources?connected=gmail');
  } catch (e) {
    console.error('[EVA] Gmail OAuth callback error:', e.message, e.stack);
    const base = (process.env.EVA_FRONTEND_URL || process.env.EVA_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
    const msg = (e.message || 'OAuth failed').replace(/^\[EVA\]\s*/i, '').slice(0, 200);
    res.redirect(base + '/sources?error=' + encodeURIComponent(msg));
  }
}

module.exports = { gmailCallback };
