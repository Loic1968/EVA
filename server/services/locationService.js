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
          area: (o.area || o.label || o.formatted_address || '').trim() || null,
          city: (o.city || '').trim() || null,
          street: (o.street || '').trim() || null,
          neighborhood: (o.neighborhood || '').trim() || null,
          formatted_address: (o.formatted_address || '').trim() || null,
          lat: typeof o.lat === 'number' ? o.lat : null,
          lng: typeof o.lng === 'number' ? o.lng : null,
          accuracy: typeof o.accuracy === 'number' ? o.accuracy : null,
          timezone: (o.timezone || '').trim() || null,
          source: (o.source || 'manual').trim(),
          geocoder: (o.geocoder || '').trim() || null,
          updatedAt: o.updatedAt || o.updated_at || null,
        };
      }
    } catch (_) {}
  }
  return { area: text, city: text, lat: null, lng: null, accuracy: null, timezone: null, source: 'manual', updatedAt: null };
}

function serializeLocation(loc) {
  return JSON.stringify({
    area: loc.area || loc.formatted_address || loc.city || null,
    city: loc.city || null,
    street: loc.street || null,
    neighborhood: loc.neighborhood || null,
    formatted_address: loc.formatted_address || null,
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
    accuracy: loc.accuracy ?? null,
    timezone: loc.timezone || null,
    source: loc.source || 'manual',
    geocoder: loc.geocoder || null,
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
  const area = (input.area || input.label || '').trim();
  const city = (input.city || '').trim();
  if (!area && !city && input.lat == null) {
    throw new Error('city or coordinates required');
  }
  const formattedAddress = (input.formatted_address || '').trim() || null;
  const loc = {
    area: area || formattedAddress || city || null,
    city: city || area || null,
    street: (input.street || '').trim() || null,
    neighborhood: (input.neighborhood || '').trim() || null,
    formatted_address: formattedAddress,
    lat: typeof input.lat === 'number' ? input.lat : null,
    lng: typeof input.lng === 'number' ? input.lng : null,
    accuracy: typeof input.accuracy === 'number' ? input.accuracy : null,
    timezone: (input.timezone || '').trim() || null,
    source: (input.source || 'manual').trim(),
    geocoder: (input.geocoder || '').trim() || null,
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
  if (!loc?.area && !loc?.city && loc?.lat == null) return '';
  const parts = ['## User location (live GPS — current position, not home address)'];
  if (loc.formatted_address) parts.push(`- Address: ${loc.formatted_address}`);
  else if (loc.area) parts.push(`- Area: ${loc.area}`);
  else if (loc.city) parts.push(`- City/area: ${loc.city}`);
  if (loc.lat != null && loc.lng != null) parts.push(`- Coordinates: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
  if (loc.accuracy != null) parts.push(`- GPS accuracy: ±${Math.round(loc.accuracy)} m`);
  if (loc.timezone) parts.push(`- Timezone: ${loc.timezone}`);
  if (loc.updatedAt) parts.push(`- Last updated: ${loc.updatedAt}`);
  if (loc.geocoder === 'google') {
    parts.push('- Address from Google Geocoding (building-level when available).');
  } else {
    parts.push('- Phone GPS ~10–20 m: street/neighborhood OK, building number often missing — normal.');
  }
  parts.push('- Do NOT ask for static home address for "where am I". Home base (if any) is in MEMORY.md for "where do I live".');
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

async function ingestClientLocation(ownerId, clientLocation) {
  if (!ownerId || !clientLocation || typeof clientLocation !== 'object') return null;
  if (clientLocation.lat == null && !clientLocation.city) return null;
  return setLocation(ownerId, { ...clientLocation, source: clientLocation.source || 'gps-live' });
}

function formatLocationReply(loc) {
  if (!loc?.area && !loc?.city && loc?.lat == null) {
    return "Je n'ai pas ta position GPS live. Ouvre EVA sur ton téléphone, autorise la géolocalisation, puis redemande.";
  }
  const parts = [];
  const place = loc.formatted_address || loc.area || loc.city;
  if (place) parts.push(`Tu es vers ${place}`);
  if (loc.lat != null && loc.lng != null) {
    parts.push(`(${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)})`);
  }
  if (loc.accuracy != null) parts.push(`précision ±${Math.round(loc.accuracy)} m`);
  if (loc.timezone) parts.push(`Fuseau ${loc.timezone}`);
  const updated = loc.updatedAt ? new Date(loc.updatedAt).getTime() : 0;
  if (updated && Date.now() - updated > 60 * 60 * 1000) {
    parts.push('— position >1h, rafraîchis le GPS si tu as bougé');
  } else if (!loc.street && loc.geocoder !== 'google') {
    parts.push('pas de numéro de bâtiment — normal avec GPS téléphone');
  }
  return parts.join(' · ');
}

async function syncToEva2(loc) {
  const base = (process.env.EVA2_PUBLIC_URL || '').replace(/\/$/, '');
  const secret = (process.env.EVA2_SSO_SECRET || '').trim();
  if (!base || !secret || (!loc.area && !loc.city && loc.lat == null)) return;

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

async function enrichWithReverseGeocode(loc) {
  if (!loc || loc.lat == null || loc.lng == null) return loc;
  if (loc.formatted_address || (loc.area && loc.geocoder === 'google')) return loc;
  try {
    const { reverseGeocode } = require('./reverseGeocodeService');
    const geo = await reverseGeocode(loc.lat, loc.lng);
    return {
      ...loc,
      area: geo.area || loc.area,
      street: geo.street || loc.street,
      neighborhood: geo.neighborhood || loc.neighborhood,
      city: geo.city || loc.city,
      formatted_address: geo.formatted_address || loc.formatted_address || null,
      geocoder: geo.geocoder || loc.geocoder || null,
    };
  } catch (_) {
    return loc;
  }
}

module.exports = {
  parseLocation,
  serializeLocation,
  getLocation,
  setLocation,
  ingestClientLocation,
  enrichWithReverseGeocode,
  formatLocationBlock,
  formatDateTimeBlock,
  formatLocationReply,
  syncToEva2,
};
