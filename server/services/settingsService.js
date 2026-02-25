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

module.exports = { getSetting, getKillSwitch, getShadowMode };
