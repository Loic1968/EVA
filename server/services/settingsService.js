/**
 * Settings service – read kill switch, shadow mode, etc. from eva.settings
 */
const db = require('../db');

async function getSetting(ownerId, key) {
  try {
    const r = await db.query(
      'SELECT value FROM eva.settings WHERE owner_id = $1 AND key = $2',
      [ownerId, key]
    );
    if (!r.rows[0]) return null;
    const val = r.rows[0].value;
    return typeof val === 'object' ? val : (val ? JSON.parse(val) : null);
  } catch (e) {
    if (/relation .* does not exist|does not exist/i.test(String(e.message))) {
      return null;
    }
    throw e;
  }
}

/** @returns {Promise<boolean>} true = kill switch ON (EVA paused) */
async function getKillSwitch(ownerId) {
  const s = await getSetting(ownerId, 'kill_switch');
  return s?.enabled === true;
}

/** @returns {Promise<boolean>} true = shadow mode ON (observe only, no actions) */
async function getShadowMode(ownerId) {
  const s = await getSetting(ownerId, 'shadow_mode');
  return s?.enabled === true;
}

/** @returns {Promise<boolean>} true = autonomous mode ON (drafts auto-approved) */
async function getAutonomousMode(ownerId) {
  const s = await getSetting(ownerId, 'autonomous_mode');
  return s?.enabled === true;
}

/** @returns {Promise<string|null>} user's voice/style profile text for P4 */
async function getStyleProfile(ownerId) {
  const s = await getSetting(ownerId, 'voice_profile');
  if (!s) return null;
  const text = (typeof s === 'object' && s != null && s.text != null)
    ? String(s.text)
    : (typeof s === 'string' ? s : null);
  return text ? text.trim() : null;
}

/** @returns {Promise<{enabled:boolean, leadMinutes:number[]}>} notification preferences */
async function getNotificationPreferences(ownerId) {
  const s = await getSetting(ownerId, 'notification_preferences');
  if (!s || typeof s !== 'object') {
    return { enabled: true, leadMinutes: [15, 60, 1440] };
  }
  const lead = s.leadMinutes || s.lead_minutes;
  const arr = Array.isArray(lead) ? lead.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [15, 60, 1440];
  return { enabled: s.enabled !== false, leadMinutes: arr.length ? arr : [15, 60, 1440] };
}

/**
 * @returns {Promise<{enabled:boolean, priorityLevel:'gmail_only'|'gmail_and_ai'}>}
 * gmail_only = Gmail IMPORTANT label only
 * gmail_and_ai = Gmail IMPORTANT + AI analysis for unread emails without the label
 */
async function getEmailImportancePreferences(ownerId) {
  const s = await getSetting(ownerId, 'email_importance_preferences');
  if (!s || typeof s !== 'object') {
    return { enabled: false, priorityLevel: 'gmail_only' };
  }
  const level = s.priorityLevel === 'gmail_and_ai' ? 'gmail_and_ai' : 'gmail_only';
  return { enabled: s.enabled === true, priorityLevel: level };
}

/** @returns {Promise<'claude'|'gpt'>} chat AI provider */
async function getAIProvider(ownerId) {
  const s = await getSetting(ownerId, 'ai_provider');
  const v = (s && typeof s === 'object' ? s.provider : s) || 'claude';
  return v === 'gpt' ? 'gpt' : 'claude';
}

/** @returns {Promise<boolean>} true = Alice persona active */
async function getAliceMode(ownerId) {
  const s = await getSetting(ownerId, 'alice_mode');
  return s?.enabled === true;
}

/** @param {number} ownerId @param {boolean} enabled */
async function setAliceMode(ownerId, enabled) {
  try {
    await db.query(
      `INSERT INTO eva.settings (owner_id, key, value)
       VALUES ($1, 'alice_mode', $2::jsonb)
       ON CONFLICT (owner_id, key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [ownerId, JSON.stringify({ enabled: !!enabled })]
    );
    return true;
  } catch (e) {
    if (/relation .* does not exist/i.test(String(e.message))) return false;
    throw e;
  }
}

module.exports = { getSetting, getKillSwitch, getShadowMode, getAutonomousMode, getStyleProfile, getNotificationPreferences, getEmailImportancePreferences, getAIProvider, getAliceMode, setAliceMode };
