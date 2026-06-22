import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keep screen awake during active voice/chat (iOS 16.4+ / Android Chrome).
 * Re-acquires after visibility returns — iOS releases wake lock when screen locks.
 */
export function useWakeLock(active) {
  const lockRef = useRef(null);
  const [unsupported, setUnsupported] = useState(false);

  const release = useCallback(async () => {
    try {
      await lockRef.current?.release();
    } catch (_) {}
    lockRef.current = null;
  }, []);

  const acquire = useCallback(async () => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      if (active) setUnsupported(true);
      return;
    }
    if (document.visibilityState !== 'visible') return;
    try {
      await release();
      lockRef.current = await navigator.wakeLock.request('screen');
      setUnsupported(false);
      lockRef.current.addEventListener('release', () => {
        lockRef.current = null;
      });
    } catch (_) {
      setUnsupported(true);
    }
  }, [active, release]);

  useEffect(() => {
    if (!active) {
      release();
      setUnsupported(false);
      return undefined;
    }
    acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      release();
    };
  }, [active, acquire, release]);

  return { unsupported };
}
