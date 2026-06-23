/** iOS / Android / narrow viewport — phone-first UX helpers */

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

/** Phone (not tablet/desktop) — used for Eva 2 SSO auto-redirect. */
export function isMobilePhone() {
  return isIOS() || isAndroid();
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
  return isMobilePhone() || isStandalonePwa() || isMobileDevice();
}

/** Mobile/PWA: always same-window. Desktop: new tab only when popup succeeds. */
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

/** Eva 2 SSO — never use window.open on phone/PWA. */
export function navigateToEva2Sso(url) {
  window.location.href = url;
}
