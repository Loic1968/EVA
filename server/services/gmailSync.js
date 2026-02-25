/**
 * Gmail Sync Service for EVA.
 * Fetches emails from Gmail API and stores them in eva.emails.
 */
const db = require('../db');
const googleOAuth = require('./googleOAuth');

const DEFAULT_FETCH_DAYS = 90; // default: last 90 days (overridable in Settings)

async function getEmailSyncDays(ownerId) {
  try {
    const r = await db.query(
      `SELECT value FROM eva.settings WHERE owner_id = $1 AND key = 'email_sync_days'`,
      [ownerId]
    );
    const val = r.rows[0]?.value;
    const days = typeof val === 'object' && val?.days != null ? Number(val.days) : Number(val);
    const n = Number.isFinite(days) && days >= 7 && days <= 365 ? days : null;
    return n ?? parseInt(process.env.GMAIL_FETCH_DAYS || String(DEFAULT_FETCH_DAYS), 10);
  } catch {
    return parseInt(process.env.GMAIL_FETCH_DAYS || String(DEFAULT_FETCH_DAYS), 10);
  }
}

/**
 * Sync emails for a given Gmail account.
 * On first run: fetches last N days (from Settings or default 90). On subsequent runs: fetches only new messages.
 */
async function syncEmails(ownerId, gmailAccountId) {
  // 1. Get account credentials
  const acctResult = await db.query(
    'SELECT id, access_token, refresh_token, expires_at, last_history_id FROM eva.gmail_accounts WHERE id = $1 AND owner_id = $2',
    [gmailAccountId, ownerId]
  );
  const acct = acctResult.rows[0];
  if (!acct) throw new Error(`Gmail account ${gmailAccountId} not found`);

  // 2. Refresh token if expired
  let accessToken = acct.access_token;
  if (acct.expires_at && new Date(acct.expires_at) < new Date()) {
    try {
      const newCreds = await googleOAuth.refreshAccessToken(acct.refresh_token);
      accessToken = newCreds.access_token;
      await db.query(
        `UPDATE eva.gmail_accounts
         SET access_token = $1, expires_at = $2, token_updated_at = now()
         WHERE id = $3`,
        [newCreds.access_token, new Date(newCreds.expiry_date), gmailAccountId]
      );
    } catch (err) {
      await db.query(
        `UPDATE eva.gmail_accounts SET sync_status = 'error', error_message = $1 WHERE id = $2`,
        [`Token refresh failed: ${err.message}`, gmailAccountId]
      );
      throw err;
    }
  }

  // 3. Mark as syncing
  await db.query(
    `UPDATE eva.gmail_accounts SET sync_status = 'syncing' WHERE id = $1`,
    [gmailAccountId]
  );

  const gmail = googleOAuth.getGmailClient(accessToken, acct.refresh_token);
  const fetchDays = await getEmailSyncDays(ownerId);

  try {
    // 4. Build query: last N days (from Settings, default 90)
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - fetchDays);
    const afterEpoch = Math.floor(afterDate.getTime() / 1000);
    const query = `after:${afterEpoch}`;

    // 5. List message IDs (paginated)
    let allMessageIds = [];
    let pageToken = null;
    do {
      const listResult = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken: pageToken || undefined,
      });
      const messages = listResult.data.messages || [];
      allMessageIds = allMessageIds.concat(messages.map(m => m.id));
      pageToken = listResult.data.nextPageToken;
    } while (pageToken && allMessageIds.length < 500); // cap at 500 for safety

    console.log(`[Gmail Sync] Found ${allMessageIds.length} messages for account ${gmailAccountId}`);

    // 6. Fetch and store each message
    let newCount = 0;
    for (const msgId of allMessageIds) {
      // Check if already synced
      const existing = await db.query(
        'SELECT id FROM eva.emails WHERE gmail_account_id = $1 AND message_id = $2',
        [gmailAccountId, msgId]
      );
      if (existing.rows.length > 0) continue;

      try {
        const msgResult = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'full',
        });
        const parsed = parseMessage(msgResult.data);
        await storeEmail(ownerId, gmailAccountId, parsed);
        newCount++;
      } catch (msgErr) {
        console.warn(`[Gmail Sync] Failed to fetch message ${msgId}:`, msgErr.message);
      }
    }

    // 7. Update account status
    await db.query(
      `UPDATE eva.gmail_accounts
       SET sync_status = 'active',
           full_sync_complete = TRUE,
           last_sync_at = now(),
           error_message = NULL
       WHERE id = $1`,
      [gmailAccountId]
    );

    // 8. Update data_sources (last_sync_at, record_count) — no updated_at (schema may not have it)
    const countResult = await db.query(
      'SELECT count(*) as cnt FROM eva.emails WHERE gmail_account_id = $1',
      [gmailAccountId]
    );
    const acctRow = await db.query('SELECT gmail_address FROM eva.gmail_accounts WHERE id = $1', [gmailAccountId]);
    const gmailAddr = acctRow.rows[0]?.gmail_address;
    if (gmailAddr) {
      await db.query(
        `UPDATE eva.data_sources SET last_sync_at = now(), record_count = $1
         WHERE owner_id = $2 AND source_type = 'gmail' AND external_id = $3`,
        [parseInt(countResult.rows[0].cnt, 10), ownerId, gmailAddr]
      );
    }

    console.log(`[Gmail Sync] Synced ${newCount} new emails for account ${gmailAccountId}`);
    return { total: allMessageIds.length, new: newCount };
  } catch (err) {
    await db.query(
      `UPDATE eva.gmail_accounts SET sync_status = 'error', error_message = $1 WHERE id = $2`,
      [`Sync failed: ${err.message}`, gmailAccountId]
    );
    throw err;
  }
}

/**
 * Parse a Gmail API message object into our schema format.
 */
function parseMessage(message) {
  const headers = message.payload?.headers || [];
  const getHeader = (name) => {
    const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : '';
  };

  // Parse from field: "Name <email>" or just "email"
  const fromRaw = getHeader('From');
  const fromMatch = fromRaw.match(/^"?([^"<]*)"?\s*<?([^>]*)>?$/);
  const fromName = fromMatch ? fromMatch[1].trim() : '';
  const fromEmail = fromMatch ? (fromMatch[2] || fromMatch[1]).trim() : fromRaw.trim();

  // Parse to/cc as arrays
  const parseAddresses = (raw) => {
    if (!raw) return [];
    return raw.split(',').map(a => {
      const m = a.match(/<([^>]+)>/);
      return m ? m[1].trim() : a.trim();
    }).filter(Boolean);
  };

  // Extract body parts
  let bodyPlain = '';
  let bodyHtml = '';
  extractBody(message.payload, (mimeType, data) => {
    const decoded = Buffer.from(data, 'base64').toString('utf-8');
    if (mimeType === 'text/plain' && !bodyPlain) bodyPlain = decoded;
    if (mimeType === 'text/html' && !bodyHtml) bodyHtml = decoded;
  });

  // Extract attachment info
  const attachments = [];
  extractAttachments(message.payload, attachments);

  // Parse date
  const dateStr = getHeader('Date');
  let receivedAt;
  try {
    receivedAt = new Date(dateStr);
    if (isNaN(receivedAt.getTime())) receivedAt = new Date(parseInt(message.internalDate, 10));
  } catch {
    receivedAt = new Date(parseInt(message.internalDate, 10));
  }

  return {
    messageId: message.id,
    threadId: message.threadId,
    fromEmail,
    fromName,
    toEmails: parseAddresses(getHeader('To')),
    ccEmails: parseAddresses(getHeader('Cc')),
    subject: getHeader('Subject') || '(no subject)',
    snippet: message.snippet || '',
    bodyPlain: bodyPlain.slice(0, 50000), // cap at 50k chars
    bodyHtml: bodyHtml.slice(0, 100000),
    labels: message.labelIds || [],
    isRead: !(message.labelIds || []).includes('UNREAD'),
    isStarred: (message.labelIds || []).includes('STARRED'),
    hasAttachments: attachments.length > 0,
    receivedAt,
    attachments,
  };
}

/**
 * Recursively extract body parts from a MIME payload.
 */
function extractBody(part, callback) {
  if (!part) return;
  if (part.body?.data) {
    callback(part.mimeType, part.body.data);
  }
  if (part.parts) {
    for (const child of part.parts) {
      extractBody(child, callback);
    }
  }
}

/**
 * Recursively extract attachment metadata from a MIME payload.
 */
function extractAttachments(part, result) {
  if (!part) return;
  if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
    result.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType,
      sizeBytes: part.body.size || 0,
    });
  }
  if (part.parts) {
    for (const child of part.parts) {
      extractAttachments(child, result);
    }
  }
}

/**
 * Store a parsed email in the database.
 */
async function storeEmail(ownerId, gmailAccountId, parsed) {
  const result = await db.query(
    `INSERT INTO eva.emails
       (owner_id, gmail_account_id, message_id, thread_id, from_email, from_name,
        to_emails, cc_emails, subject, snippet, body_plain, body_html,
        labels, is_read, is_starred, has_attachments, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (gmail_account_id, message_id) DO NOTHING
     RETURNING id`,
    [
      ownerId, gmailAccountId, parsed.messageId, parsed.threadId,
      parsed.fromEmail, parsed.fromName,
      parsed.toEmails, parsed.ccEmails,
      parsed.subject, parsed.snippet, parsed.bodyPlain, parsed.bodyHtml,
      parsed.labels, parsed.isRead, parsed.isStarred, parsed.hasAttachments,
      parsed.receivedAt,
    ]
  );

  // Store attachment metadata if email was inserted
  if (result.rows[0] && parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      await db.query(
        `INSERT INTO eva.email_attachments (email_id, attachment_id, filename, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.rows[0].id, att.attachmentId, att.filename, att.mimeType, att.sizeBytes]
      );
    }
  }

  return result.rows[0]?.id || null;
}

/**
 * Search emails using PostgreSQL full-text search.
 * @param {string} folder - 'inbox' | 'sent' | 'draft' | 'all' | null (default inbox)
 */
async function searchEmails(ownerId, queryText, limit = 5, gmailAccountId = null, folder = 'inbox') {
  if (!queryText || queryText.trim().length === 0) return [];

  const words = queryText.trim().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return [];
  const tsquery = words.map(w => w.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean).join(' | ');

  const folderLabel = folder === 'sent' ? 'SENT' : folder === 'draft' ? 'DRAFT' : folder === 'all' ? null : 'INBOX';
  const labelCondition = folderLabel
    ? ` AND labels @> ARRAY['${folderLabel}']::text[]`
    : '';

  const selectCols = 'id, gmail_account_id, from_email, from_name, to_emails, subject, snippet';
  let query = `SELECT ${selectCols},
        left(body_plain, 300) as body_preview,
        received_at, labels, is_read, is_starred, has_attachments
     FROM eva.emails
     WHERE owner_id = $1
       AND to_tsvector('english', coalesce(subject,'') || ' ' || coalesce(body_plain,''))
           @@ to_tsquery('english', $2)${labelCondition}`;
  const params = [ownerId, tsquery];
  if (gmailAccountId) {
    query += ' AND gmail_account_id = $3';
    params.push(gmailAccountId);
  }
  query += ' ORDER BY received_at DESC LIMIT $' + (params.length + 1);
  params.push(limit);

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Get recent emails for an owner (from synced DB, no Gmail API).
 * Used by Realtime voice to inject email context into session instructions.
 */
async function getRecentEmails(ownerId, limit = 8) {
  try {
    const r = await db.query(
      `SELECT id, from_email, from_name, to_emails, labels, subject, snippet, left(body_plain, 600) as body_preview, received_at
       FROM eva.emails
       WHERE owner_id = $1
       ORDER BY received_at DESC
       LIMIT $2`,
      [ownerId, Math.min(limit, 50)]
    );
    return r.rows;
  } catch (err) {
    if (/relation "eva\.emails" does not exist/i.test(String(err.message))) {
      return [];
    }
    throw err;
  }
}

module.exports = {
  syncEmails,
  parseMessage,
  searchEmails,
  getRecentEmails,
};
