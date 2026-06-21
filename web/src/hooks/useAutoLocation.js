import { useEffect, useRef } from 'react';
import { api } from '../api';
import {
  detectCurrentLocation,
  isAutoLocationEnabled,
  markLocationUpdated,
  shouldRefreshLocation,
} from '../utils/geolocation';

/**
 * Refresh GPS location in the background when the user opens EVA (PWA or browser).
 */
export function useAutoLocation(isAuthenticated) {
  const running = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !isAutoLocationEnabled()) return;
    if (!shouldRefreshLocation()) return;
    if (running.current) return;

    running.current = true;
    (async () => {
      try {
        const loc = await detectCurrentLocation();
        if (!loc.city && loc.lat == null) return;
        await api.setLocation(loc);
        markLocationUpdated();
      } catch {
        // Permission denied or timeout — user can use Settings → Use GPS
      } finally {
        running.current = false;
      }
    })();
  }, [isAuthenticated]);
}
