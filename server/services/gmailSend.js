/**
 * Gmail Send Service – send drafts via Gmail API.
 * Uses gmail.send scope; requires OAuth tokens in eva.gmail_accounts.
 */
const db = require('../db');
const googleOAuth = require('./googleOAuth');

/**
 * Get primary Gmail account for owner (first active one).
 */
async function getPrimaryGmailAccount(ownerId) {
  const r = await db.query(
    `SELECT id, access_token, refresh_token, expires_at, gmail_address
     FROM eva.gmail_accounts WHERE owner_id = $1 AND sync_status = 'active'
     ORDER BY id LIMIT 1`,
    [ownerId]
  );
  return r.rows[0] || null;
}

/**
 * Resolve recipient for a draft. Uses to_emails if set; else derives from thread (reply).
 * @returns {Promise<string|null>} comma-separated emails or null
 */
async function resolveRecipient(ownerId, draft) {
  const to = draft.to_emails && String(draft.to_emails).trim();
  if (to) return to;

  if (!draft.thread_id) return null;

  // Reply: get from_email of the most recent email in this thread
  const r = await db.query(
    `SELECT e.from_email
     FROM eva.emails e
     JOIN eva.gmail_accounts g ON g.id = e.gmail_account_id AND g.owner_id = $1
     WHERE e.thread_id = $2
     ORDER BY e.received_at DESC LIMIT 1`,
    [ownerId, draft.thread_id]
  );
  return r.rows[0]?.from_email || null;
}

/**
 * Build RFC 2822 message and base64url encode for Gmail API.
 */
function buildRawMessage({ from, to, subject, body, threadId }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject || '(no subject)'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    body || '',
  ];
  const raw = lines.join('\r\n');
  return Buffer.from(raw, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Send a draft via Gmail API.
 * @param {number} ownerId
 * @param {object} draft – { id, channel, thread_id, subject_or_preview, body, to_emails }
 * @returns {Promise<{messageId:string, threadId?:string}>}
 */
async function sendDraft(ownerId, draft) {
  if (draft.channel !== 'email') {
    throw new Error(`Sending not supported for channel: ${draft.channel}`);
  }

  const acct = await getPrimaryGmailAccount(ownerId);
  if (!acct) throw new Error('No Gmail account connected. Connect Gmail in Data Sources.');

  const recipient = await resolveRecipient(ownerId, draft);
  if (!recipient) throw new Error('No recipient. Set to_emails on the draft or ensure thread_id matches a synced email.');

  let accessToken = acct.access_token;
  if (acct.expires_at && new Date(acct.expires_at) < new Date()) {
    const newCreds = await googleOAuth.refreshAccessToken(acct.refresh_token);
    accessToken = newCreds.access_token;
    await db.query(
      `UPDATE eva.gmail_accounts SET access_token = $1, expires_at = $2, token_updated_at = now() WHERE id = $3`,
      [newCreds.access_token, new Date(newCreds.expiry_date), acct.id]
    );
  }

  const gmail = googleOAuth.getGmailClient(accessToken, acct.refresh_token);
  const raw = buildRawMessage({
    from: acct.gmail_address,
    to: recipient,
    subject: draft.subject_or_preview || '(no subject)',
    body: draft.body || '',
    threadId: draft.thread_id,
  });

  const requestBody = { raw };
  if (draft.thread_id) requestBody.threadId = draft.thread_id;

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  return {
    messageId: result.data.id,
    threadId: result.data.threadId,
  };
}

/**
 * Send a direct email (for notifications, reminders). Uses primary Gmail account.
 * @param {number} ownerId
 * @param {{ to: string, subject: string, body: string }}
 */
async function sendEmail(ownerId, { to, subject, body }) {
  const acct = await getPrimaryGmailAccount(ownerId);
  if (!acct) throw new Error('No Gmail account connected.');

  let accessToken = acct.access_token;
  if (acct.expires_at && new Date(acct.expires_at) < new Date()) {
    const newCreds = await googleOAuth.refreshAccessToken(acct.refresh_token);
    accessToken = newCreds.access_token;
    await db.query(
      `UPDATE eva.gmail_accounts SET access_token = $1, expires_at = $2, token_updated_at = now() WHERE id = $3`,
      [newCreds.access_token, new Date(newCreds.expiry_date), acct.id]
    );
  }

  const gmail = googleOAuth.getGmailClient(accessToken, acct.refresh_token);
  const raw = buildRawMessage({
    from: acct.gmail_address,
    to: to || acct.gmail_address,
    subject: subject || '(no subject)',
    body: body || '',
  });

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
  return { messageId: result.data.id };
}

module.exports = { sendDraft, resolveRecipient, sendEmail };
