/**
 * User geolocation — stored in memory_items, injected into EVA prompts, synced to Eva 2 VPS.
 */
const crypto = require('crypto');

function parseLocation(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text);
      if (o && typeof o === 'object') {
        return {
          city: (o.city || o.label || '').trim() || null,
          lat: typeof o.lat === 'number' ? o.lat : null,
          lng: typeof o.lng === 'number' ? o.lng : null,
          accuracy: typeof o.accuracy === 'number' ? o.accuracy : null,
          timezone: (o.timezone || '').trim() || null,
          source: (o.source || 'manual').trim(),
          updatedAt: o.updatedAt || o.updated_at || null,
        };
      }
    } catch (_) {}
  }
  return { city: text, lat: null, lng: null, accuracy: null, timezone: null, source: 'manual', updatedAt: null };
}

function serializeLocation(loc) {
  return JSON.stringify({
    city: loc.city || null,
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
    accuracy: loc.accuracy ?? null,
    timezone: loc.timezone || null,
    source: loc.source || 'manual',
    updatedAt: loc.updatedAt || new Date().toISOString(),
  });
}

async function getLocation(ownerId) {
  if (!ownerId) return null;
  const memoryItems = require('./memoryItemsService');
  const item = await memoryItems.getByKey(ownerId, 'current_location');
  return parseLocation(item?.value);
}

async function setLocation(ownerId, input) {
  const city = (input.city || input.label || '').trim();
  if (!city && input.lat == null) {
    throw new Error('city or coordinates required');
  }
  const loc = {
    city: city || null,
    lat: typeof input.lat === 'number' ? input.lat : null,
    lng: typeof input.lng === 'number' ? input.lng : null,
    accuracy: typeof input.accuracy === 'number' ? input.accuracy : null,
    timezone: (input.timezone || '').trim() || null,
    source: (input.source || 'manual').trim(),
    updatedAt: new Date().toISOString(),
  };
  const memoryItems = require('./memoryItemsService');
  const value = serializeLocation(loc);
  await memoryItems.addMemoryItem(ownerId, 'preference', 'current_location', value);
  if (process.env.EVA_STRUCTURED_MEMORY === 'true') {
    try {
      const factsService = require('./factsService');
      await factsService.addRemember(ownerId, 'current_location', loc.city || `${loc.lat},${loc.lng}`);
    } catch (_) {}
  }
  syncToEva2(loc).catch((e) => console.warn('[EVA location] Eva 2 sync:', e.message));
  return loc;
}

function formatLocationBlock(loc) {
  if (!loc?.city && loc?.lat == null) return '';
  const parts = ['## User location (GPS / settings — use for "where am I", local time, weather, nearby)'];
  if (loc.city) parts.push(`- City/area: ${loc.city}`);
  if (loc.lat != null && loc.lng != null) parts.push(`- Coordinates: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
  if (loc.timezone) parts.push(`- Timezone: ${loc.timezone}`);
  if (loc.updatedAt) parts.push(`- Last updated: ${loc.updatedAt}`);
  parts.push('- Do NOT invent a different city unless the user says they moved.');
  return `\n\n${parts.join('\n')}\n`;
}

function formatDateTimeBlock(loc) {
  const tz = loc?.timezone || null;
  const now = new Date();
  let dateTimeStr;
  try {
    dateTimeStr = now.toLocaleString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(tz ? { timeZone: tz } : {}),
    });
  } catch (_) {
    dateTimeStr = now.toLocaleString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const where = loc?.city ? ` (${loc.city}${tz ? `, ${tz}` : ''})` : '';
  return `\n\n## DATE ET HEURE ACTUELLES\nMaintenant${where}: ${dateTimeStr}. Utilise pour "Quelle heure est-il?", "Where am I?", "What time is it?".\n`;
}

async function syncToEva2(loc) {
  const base = (process.env.EVA2_PUBLIC_URL || '').replace(/\/$/, '');
  const secret = (process.env.EVA2_SSO_SECRET || '').trim();
  if (!base || !secret || (!loc.city && loc.lat == null)) return;

  const exp = Date.now() + 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ location: loc, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const token = `${payload}.${sig}`;

  const res = await fetch(`${base}/api/user/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
}

module.exports = {
  parseLocation,
  serializeLocation,
  getLocation,
  setLocation,
  formatLocationBlock,
  formatDateTimeBlock,
  syncToEva2,
};
