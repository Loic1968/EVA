/**
 * Reverse geocoding — Google Geocoding API (primary), Nominatim (fallback).
 * Enable Geocoding API in Google Cloud: https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com
 */
const NOMINATIM_UA = 'EVA-Halisoft/1.0 (reverse-geocode)';

function geocodingApiKey() {
  return (
    process.env.GOOGLE_GEOCODING_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.REACT_APP_GOOGLE_CLOUD_API_KEY ||
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY ||
    ''
  ).trim();
}

function component(components, type) {
  const hit = (components || []).find((c) => (c.types || []).includes(type));
  return hit?.long_name || null;
}

function formatAddressFromGoogle(data) {
  const result = data?.results?.[0];
  if (!result) return null;
  const formatted = result.formatted_address || null;
  const parts = result.address_components || [];
  const streetNumber = component(parts, 'street_number');
  const route = component(parts, 'route');
  const street = [streetNumber, route].filter(Boolean).join(' ') || null;
  const neighborhood =
    component(parts, 'sublocality_level_1') ||
    component(parts, 'sublocality') ||
    component(parts, 'neighborhood') ||
    component(parts, 'premise') ||
    null;
  const city =
    component(parts, 'locality') ||
    component(parts, 'administrative_area_level_2') ||
    component(parts, 'administrative_area_level_1') ||
    null;
  const country = component(parts, 'country');
  const area = formatted || [street, neighborhood, city].filter(Boolean).join(', ') || null;
  return {
    area,
    street,
    neighborhood,
    city,
    country,
    display_name: formatted,
    formatted_address: formatted,
    geocoder: 'google',
  };
}

function formatAddressFromNominatim(data) {
  const addr = data?.address || {};
  const streetParts = [addr.house_number, addr.road || addr.pedestrian || addr.footway].filter(Boolean);
  const street = streetParts.length ? streetParts.join(' ') : null;
  const neighborhood = addr.neighbourhood || addr.suburb || addr.quarter || addr.district || null;
  const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || null;
  const labelParts = [street, neighborhood, city].filter(Boolean);
  const area = labelParts.length ? labelParts.join(', ') : data?.display_name || null;
  return {
    area,
    street,
    neighborhood,
    city,
    country: addr.country || null,
    display_name: data?.display_name || null,
    formatted_address: null,
    geocoder: 'nominatim',
  };
}

async function reverseGeocodeGoogle(lat, lon, key) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${lat},${lon}`);
  url.searchParams.set('key', key);
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`Google: ${data.status || 'no results'}`);
  }
  const formatted = formatAddressFromGoogle(data);
  if (!formatted?.area) throw new Error('Google: empty address');
  return formatted;
}

async function reverseGeocodeNominatim(lat, lon) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'json');
  const res = await fetch(url, {
    headers: { 'User-Agent': NOMINATIM_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  const formatted = formatAddressFromNominatim(data);
  if (!formatted?.area && !formatted?.city) throw new Error('Nominatim: empty address');
  return formatted;
}

async function reverseGeocode(lat, lon) {
  const latN = Number(lat);
  const lonN = Number(lon);
  if (!Number.isFinite(latN) || !Number.isFinite(lonN)) {
    throw new Error('invalid coordinates');
  }

  const key = geocodingApiKey();
  if (key) {
    try {
      return await reverseGeocodeGoogle(latN, lonN, key);
    } catch (e) {
      console.warn('[EVA geocode] Google failed, falling back to Nominatim:', e.message);
    }
  }

  return reverseGeocodeNominatim(latN, lonN);
}

module.exports = {
  geocodingApiKey,
  reverseGeocode,
  reverseGeocodeGoogle,
  reverseGeocodeNominatim,
  formatAddressFromGoogle,
  formatAddressFromNominatim,
};
