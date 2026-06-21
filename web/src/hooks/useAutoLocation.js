import { useEffect, useRef } from 'react';
import { api } from '../api';
import {
  detectCurrentLocation,
  isAutoLocationEnabled,
  markLocationUpdated,
  shouldRefreshLocation,
} from '../utils/geolocation';

async function pushLocation() {
  const loc = await detectCurrentLocation({ maximumAge: 60 * 1000 });
  if (!loc.city && loc.lat == null) return;
  await api.setLocation(loc);
  markLocationUpdated();
}

/**
 * Background GPS refresh when EVA is open (PWA / browser).
 */
export function useAutoLocation(isAuthenticated) {
  const running = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !isAutoLocationEnabled()) return;

    const tick = async () => {
      if (running.current || !shouldRefreshLocation()) return;
      running.current = true;
      try {
        await pushLocation();
      } catch {
        // Permission denied — user can enable in Settings
      } finally {
        running.current = false;
      }
    };

    tick();

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isAuthenticated]);
}
