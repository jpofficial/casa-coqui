'use client';

import { useState, useEffect } from 'react';
import usePush, { isPushCapable, detectPlatform, isStandalone } from '@/hooks/usePush';
import PushPermissionExplainer from '@/components/guest/PushPermissionExplainer';

// Cooldown in ms before we re-show the explainer after a dismissal
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * PushPermissionGate — wraps a section of the guest portal and injects
 * the appropriate push-permission UI before the section content.
 *
 * The component is aware of the current push/platform state and handles:
 *   - push already granted  → renders children only
 *   - push denied           → renders a "how to re-enable" note
 *   - iOS not installed     → renders install-first prompt
 *   - default (not asked)   → renders pre-permission explainer
 *   - push not supported    → renders children only (silently)
 *
 * Props:
 *   bookingCode   string       — booking code for token attribution
 *   storageKey    string       — localStorage key to debounce dismissals
 *   compact       bool         — use compact banner style (default false)
 *   children      ReactNode    — content rendered below the permission UI
 */
export default function PushPermissionGate({
  bookingCode,
  storageKey = 'push_explainer_dismissed',
  compact = false,
  children,
}) {
  const { permission, requestPermission, supported, pushCapable, platform, standalone } = usePush();

  const [dismissed, setDismissed] = useState(true); // start hidden until hydrated
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const ts = parseInt(raw, 10);
      if (Date.now() - ts < DISMISS_COOLDOWN_MS) {
        setDismissed(true);
      } else {
        setDismissed(false);
      }
    } else {
      setDismissed(false);
    }
    setHydrated(true);
  }, [storageKey]);

  function handleDismiss() {
    localStorage.setItem(storageKey, String(Date.now()));
    setDismissed(true);
  }

  async function handleEnable() {
    await requestPermission({ bookingCode });
  }

  const plat = detectPlatform();
  const sa = isStandalone();

  // Do not render anything permission-related until hydrated
  if (!hydrated) return <>{children}</>;

  // Push is granted — nothing to show
  if (permission === 'granted') return <>{children}</>;

  // Not supported at all (old browser, etc) — silently skip
  if (!supported) return <>{children}</>;

  // iOS but not installed as PWA
  if (plat === 'ios' && !sa) {
    return (
      <>
        {!dismissed && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">Install the app for notifications</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  On iPhone, add Casa Coqui to your Home Screen (via the Share menu) to receive push notifications.
                </p>
              </div>
              <button
                onClick={handleDismiss}
                className="text-amber-400 hover:text-amber-600 transition flex-shrink-0 p-1"
                aria-label="Dismiss"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {children}
      </>
    );
  }

  // Push denied by the user — show a settings hint
  if (permission === 'denied') {
    return (
      <>
        {!dismissed && (
          <div className="mb-4 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-700">Notifications blocked</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  To re-enable, go to your phone&apos;s Settings &rarr; {plat === 'ios' ? 'Safari' : 'Chrome'} &rarr; Notifications and allow Casa Coqui.
                </p>
              </div>
              <button
                onClick={handleDismiss}
                className="text-gray-300 hover:text-gray-500 transition flex-shrink-0 p-1"
                aria-label="Dismiss"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {children}
      </>
    );
  }

  // Default — not yet asked
  if (!dismissed) {
    return (
      <>
        <div className="mb-4">
          <PushPermissionExplainer
            onEnable={handleEnable}
            onDismiss={handleDismiss}
            compact={compact}
          />
        </div>
        {children}
      </>
    );
  }

  return <>{children}</>;
}
