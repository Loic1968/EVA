import { useEffect, useRef } from 'react';
import { api } from '../api';
import {
  detectCurrentLocation,
  isAutoLocationEnabled,
  markLocationUpdated,
  reverseGeocode,
  getBrowserTimezone,
  shouldRefreshLocation,
} from '../utils/geolocation';

const TICK_MS = 90 * 1000;
const MIN_MS = 90 * 1000;
const MOVE_M = 40;

function movedEnough(last, lat, lng) {
  if (!last) return true;
  const r = 6371000;
  const p = Math.PI / 180;
  const a =
    0.5 -
    Math.cos((lat - last.lat) * p) / 2 +
    (Math.cos(last.lat * p) * Math.cos(lat * p) * (1 - Math.cos((lng - last.lng) * p))) / 2;
  return 2 * r * Math.asin(Math.sqrt(a)) >= MOVE_M;
}

async function pushLocation(force = false, cachedPos = null) {
  let loc = null;
  if (cachedPos?.coords) {
    const { latitude: lat, longitude: lng, accuracy } = cachedPos.coords;
    let geo = { area: null, street: null, neighborhood: null, city: null };
    try {
      geo = await reverseGeocode(lat, lng);
    } catch (_) {}
    loc = {
      area: geo.area,
      street: geo.street,
      neighborhood: geo.neighborhood,
      city: geo.city,
      lat,
      lng,
      accuracy,
      timezone: getBrowserTimezone(),
      source: 'gps-auto',
    };
  } else {
    loc = await detectCurrentLocation({
      maximumAge: force ? 0 : 60 * 1000,
      timeout: force ? 15000 : 10000,
    });
  }
  if (!loc?.area && !loc?.city && loc?.lat == null) return null;
  await api.setLocation(loc);
  markLocationUpdated();
  return loc;
}

/**
 * GPS auto : sync EVA 1 + Eva 2 VPS tant que l'app est ouverte (PWA / Safari).
 */
export function useAutoLocation(isAuthenticated) {
  const running = useRef(false);
  const lastSent = useRef(null);
  const watchId = useRef(null);

  useEffect(() => {
    if (!isAuthenticated || !isAutoLocationEnabled()) return;

    const tick = async (force = false, cachedPos = null) => {
      const lat = cachedPos?.coords?.latitude;
      const lng = cachedPos?.coords?.longitude;
      const moved = lat != null && lng != null && movedEnough(lastSent.current, lat, lng);
      if (!force && !moved && !shouldRefreshLocation(MIN_MS)) return;
      if (running.current) return;
      running.current = true;
      try {
        const loc = await pushLocation(force, cachedPos);
        if (loc?.lat != null) lastSent.current = { lat: loc.lat, lng: loc.lng };
      } catch {
        // Permission denied — enable in Settings
      } finally {
        running.current = false;
      }
    };

    const startWatch = () => {
      if (watchId.current != null || !navigator.geolocation) return;
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => tick(false, pos),
        () => {},
        { enableHighAccuracy: true, maximumAge: 60 * 1000, timeout: 15000 },
      );
    };

    const stopWatch = () => {
      if (watchId.current == null) return;
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        startWatch();
        tick(true);
      } else {
        stopWatch();
      }
    };

    onVisible();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') tick(false);
    }, TICK_MS);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', () => {
      if (document.visibilityState === 'visible') tick(true);
    });

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      stopWatch();
    };
  }, [isAuthenticated]);
}
