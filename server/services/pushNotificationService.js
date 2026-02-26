/**
 * Web Push notification service – send notifications to user's browser/phone.
 * Requires VAPID keys: EVA_VAPID_PUBLIC_KEY and EVA_VAPID_PRIVATE_KEY (generate with: npx web-push generate-vapid-keys)
 */
const db = require('../db');
const webPush = require('web-push');

let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return true;
  const publicKey = process.env.EVA_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.EVA_VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return false;
  }
  webPush.setVapidDetails(
    process.env.EVA_VAPID_MAILTO || 'mailto:loic@halisoft.biz',
    publicKey.trim(),
    privateKey.trim()
  );
  vapidConfigured = true;
  return true;
}

/**
 * Save a push subscription for an owner.
 * @param {number} ownerId
 * @param {{endpoint:string, keys:{p256dh:string, auth:string}}} subscription – from PushManager.subscribe()
 * @param {string} [userAgent]
 */
async function saveSubscription(ownerId, subscription, userAgent = null) {
  if (!subscription?.endpoint) return null;
  const keys = subscription.keys || {};
  try {
    const r = await db.query(
      `INSERT INTO eva.push_subscriptions (owner_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4, user_agent = $5
       RETURNING id`,
      [ownerId, subscription.endpoint, keys.p256dh || null, keys.auth || null, userAgent || null]
    );
    return r.rows[0]?.id || null;
  } catch (err) {
    if (/relation .* does not exist/i.test(String(err.message))) {
      console.warn('[Push] push_subscriptions table missing. Run migration 010.');
      return null;
    }
    throw err;
  }
}

/**
 * Check if owner has any push subscription.
 */
async function hasSubscription(ownerId) {
  try {
    const r = await db.query(
      'SELECT 1 FROM eva.push_subscriptions WHERE owner_id = $1 LIMIT 1',
      [ownerId]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Send a push notification to all subscriptions of an owner.
 * @param {number} ownerId
 * @param {{title:string, body?:string, data?:object}} payload
 * @returns {Promise<{sent:number, failed:number}>}
 */
async function sendToOwner(ownerId, { title, body = '', data = {} }) {
  if (!ensureVapid()) {
    return { sent: 0, failed: 0 };
  }
  try {
    const r = await db.query(
      'SELECT endpoint, p256dh, auth FROM eva.push_subscriptions WHERE owner_id = $1',
      [ownerId]
    );
    if (r.rows.length === 0) return { sent: 0, failed: 0 };

    const payload = JSON.stringify({ title, body, data, timestamp: Date.now() });
    let sent = 0;
    let failed = 0;

    for (const sub of r.rows) {
      try {
        const subObj = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };
        await webPush.sendNotification(subObj, payload, {
          TTL: 86400, // 24h
          urgency: 'high',
        });
        sent++;
      } catch (err) {
        failed++;
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.query('DELETE FROM eva.push_subscriptions WHERE owner_id = $1 AND endpoint = $2', [ownerId, sub.endpoint]);
        }
        console.warn('[Push] Send failed:', err.message);
      }
    }
    return { sent, failed };
  } catch (err) {
    console.warn('[Push] sendToOwner failed:', err.message);
    return { sent: 0, failed: 0 };
  }
}

/**
 * Get public VAPID key for client-side subscription.
 */
function getPublicKey() {
  return process.env.EVA_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || null;
}

module.exports = { saveSubscription, hasSubscription, sendToOwner, getPublicKey, ensureVapid };
