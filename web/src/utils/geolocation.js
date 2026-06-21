const NOMINATIM_UA = 'EVA-Halisoft/1.0 (location-settings)';

export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': NOMINATIM_UA },
  });
  if (!res.ok) throw new Error('Reverse geocoding failed');
  const data = await res.json();
  const addr = data?.address || {};
  return (
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.county ||
    data?.display_name ||
    null
  );
}

export function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function readCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: options.maximumAge ?? 5 * 60 * 1000,
      ...options,
    });
  });
}

export async function detectCurrentLocation(options = {}) {
  const pos = await readCurrentPosition(options);
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  const city = await reverseGeocode(lat, lng);
  return {
    city,
    lat,
    lng,
    accuracy,
    timezone: getBrowserTimezone(),
    source: 'gps',
  };
}

const LOCATION_PATTERNS = [
  /où\s+(?:suis|je\s+suis)/i,
  /where\s+am\s+i/i,
  /(?:quelle|what)\s+(?:heure|time)\s+(?:est[- ]?il|is\s+it)/i,
  /(?:ma|my)\s+(?:position|localisation|location)/i,
  /(?:géo|geo)loc/i,
  /j['']habite\s+où/i,
  /where\s+(?:do\s+i\s+)?live/i,
];

export function isLocationQuestion(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return LOCATION_PATTERNS.some((re) => re.test(t));
}

/** Fresh GPS before chat — force on "où suis-je", otherwise respect throttle. */
export async function refreshLocationForChat(message, { force = false } = {}) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  const needsFresh = force || isLocationQuestion(message);
  if (!needsFresh && !isAutoLocationEnabled()) return null;
  if (!needsFresh && !shouldRefreshLocation(5 * 60 * 1000)) return null;

  try {
    const loc = await detectCurrentLocation({
      maximumAge: needsFresh ? 0 : 60 * 1000,
      timeout: needsFresh ? 20000 : 12000,
    });
    if (!loc.city && loc.lat == null) return null;
    markLocationUpdated();
    return loc;
  } catch {
    return null;
  }
}

export const AUTO_LOCATION_KEY = 'eva_auto_location';
export const LOCATION_STAMP_KEY = 'eva_location_updated_at';

export function isAutoLocationEnabled() {
  const v = localStorage.getItem(AUTO_LOCATION_KEY);
  return v !== 'false';
}

export function setAutoLocationEnabled(on) {
  localStorage.setItem(AUTO_LOCATION_KEY, on ? 'true' : 'false');
}

export function shouldRefreshLocation(minIntervalMs = 5 * 60 * 1000) {
  const raw = localStorage.getItem(LOCATION_STAMP_KEY);
  if (!raw) return true;
  const ts = Number(raw);
  return !Number.isFinite(ts) || Date.now() - ts >= minIntervalMs;
}

export function markLocationUpdated() {
  localStorage.setItem(LOCATION_STAMP_KEY, String(Date.now()));
}
