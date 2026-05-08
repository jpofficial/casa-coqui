// ─── Shared platform detection utilities ─────────────────────────────────────
// Client-side only — these access `navigator` and `window`.
// Safe to import anywhere; each function guards against SSR with typeof checks.

/**
 * Detect the current platform.
 * Includes the iPadOS 13+ fix: iPadOS reports a desktop (Macintosh) user agent,
 * so we fall back to checking `navigator.maxTouchPoints > 1`.
 *
 * @returns {'ios' | 'android' | 'desktop' | 'unknown'}
 */
export function detectPlatform() {
  if (typeof window === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios';
  // iPadOS 13+ reports a desktop (Macintosh) UA — detect via touch capability
  if (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

/**
 * Whether the app is running in standalone (installed PWA) mode.
 *
 * @returns {boolean}
 */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true
  );
}

/**
 * Extract the iOS version from the user agent string.
 * Falls back to `Version/X.Y` for iPadOS desktop UA.
 *
 * @returns {{ major: number, minor: number } | null}
 */
export function getIOSVersion() {
  if (typeof window === 'undefined') return null;
  const ua = navigator.userAgent || '';
  const iosMatch = ua.match(/OS (\d+)_(\d+)/);
  const safariMatch = ua.match(/Version\/(\d+)\.(\d+)/);
  const match = iosMatch || safariMatch;
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
  };
}

/**
 * Whether the current device/browser can receive push notifications.
 * On iOS, requires standalone mode AND iOS 16.4+.
 * On other platforms, checks for Notification API and serviceWorker support.
 *
 * @returns {boolean}
 */
export function isPushCapable() {
  if (typeof window === 'undefined') return false;
  const platform = detectPlatform();
  if (platform === 'ios') {
    if (!isStandalone()) return false;
    const version = getIOSVersion();
    if (!version) return false;
    return version.major > 16 || (version.major === 16 && version.minor >= 4);
  }
  return 'Notification' in window && 'serviceWorker' in navigator;
}
