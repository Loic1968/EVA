/**
 * gmail.send_draft — Send an approved draft via Gmail API.
 * Reads OAuth tokens from eva.gmail_accounts, refreshes if needed.
 */
import { query } from '../../core/db.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

async function refreshToken(refreshToken) {
  const clientId = process.env.EVA_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.EVA_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth credentials not configured');

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  return res.json();
}

async function getAccessToken(ownerId) {
  const r = await query(
    `SELECT id, access_token, refresh_token, expires_at FROM eva.gmail_accounts
     WHERE owner_id = $1 AND sync_status = 'active' LIMIT 1`,
    [ownerId]
  );
  const acct = r.rows[0];
  if (!acct) throw new Error('No active Gmail account');

  if (acct.expires_at && new Date(acct.expires_at) < new Date()) {
    const tokens = await refreshToken(acct.refresh_token);
    await query(
      `UPDATE eva.gmail_accounts SET access_token = $1, expires_at = $2, token_updated_at = now() WHERE id = $3`,
      [tokens.access_token, new Date(Date.now() + (tokens.expires_in || 3600) * 1000), acct.id]
    );
    return { accessToken: tokens.access_token, gmailAddress: null, accountId: acct.id };
  }
  return { accessToken: acct.access_token, gmailAddress: null, accountId: acct.id };
}

function buildRawEmail({ from, to, subject, body, threadId }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ];
  // Base64url encode
  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
  return raw;
}

export async function gmailSendDraft(args, ctx) {
  const ownerId = args.owner_id ?? ctx.actor_id;
  const { to, subject, body, thread_id } = args;

  if (!ownerId) return { ok: false, error: 'owner_id required' };
  if (!to) return { ok: false, error: 'to (recipient email) required' };
  if (!body) return { ok: false, error: 'body required' };

  try {
    const { accessToken, accountId } = await getAccessToken(ownerId);

    // Get sender address
    const acctR = await query('SELECT gmail_address FROM eva.gmail_accounts WHERE id = $1', [accountId]);
    const from = acctR.rows[0]?.gmail_address || 'me';

    const raw = buildRawEmail({ from, to, subject: subject || '(no subject)', body, threadId: thread_id });

    const payload = { raw };
    if (thread_id) payload.threadId = thread_id;

    const res = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Gmail send failed: ${res.status} ${errText}` };
    }

    const data = await res.json();
    return {
      ok: true,
      data: { message_id: data.id, thread_id: data.threadId, status: 'sent' },
    };
  } catch (err) {
    return { ok: false, error: `gmail.send_draft failed: ${err.message}` };
  }
}

export const gmailSendDraftSchema = {
  owner_id: { type: 'number', description: 'Owner ID' },
  to: { type: 'string', description: 'Recipient email', required: true },
  subject: { type: 'string', description: 'Email subject' },
  body: { type: 'string', description: 'Email body (plain text)', required: true },
  thread_id: { type: 'string', description: 'Gmail thread ID (for replies)' },
};
