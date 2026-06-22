/** iOS / Android / narrow viewport — phone-first UX helpers */

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  return (
    isIOS()
    || isAndroid()
    || window.matchMedia('(max-width: 768px)').matches
  );
}

export function isStandalonePwa() {
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
  );
}

/** Popups are unreliable on iOS Safari / installed PWA — navigate same window. */
export function prefersSameWindowNav() {
  return isIOS() || isStandalonePwa() || isMobileDevice();
}

export function openUrl(url, tab = null) {
  if (prefersSameWindowNav()) {
    window.location.href = url;
    return;
  }
  if (tab) {
    try {
      tab.location.href = url;
      return;
    } catch {
      try {
        tab.close();
      } catch {
        /* ignore */
      }
    }
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.href = url;
}
