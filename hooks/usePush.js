'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, setDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import app from '@/lib/firebase';

// ─── Singleton messaging instance ─────────────────────────────────────────────
let messagingInstance = null;

async function getMessagingInstance() {
  if (messagingInstance) return messagingInstance;
  if (typeof window === 'undefined' || !('Notification' in window)) return null;

  try {
    const { getMessaging } = await import('firebase/messaging');
    messagingInstance = getMessaging(app);
    return messagingInstance;
  } catch (err) {
    console.warn('[FCM] Firebase Messaging not supported:', err);
    return null;
  }
}

// ─── Platform detection helpers ───────────────────────────────────────────────
export function detectPlatform() {
  if (typeof window === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios';
  // iPadOS 13+ reports a desktop (Macintosh) UA — detect via touch capability
  if (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true
  );
}

// iOS Safari does not support the Push API at all outside of standalone mode.
// Even in standalone mode it requires iOS 16.4+.
export function isPushCapable() {
  if (typeof window === 'undefined') return false;
  const platform = detectPlatform();
  if (platform === 'ios') {
    // Must be in standalone mode AND iOS 16.4+
    if (!isStandalone()) return false;
    // iPhone/iPod UA: "OS 17_4", iPadOS desktop UA: "Version/17.4"
    const iosMatch = navigator.userAgent.match(/OS (\d+)_(\d+)/);
    const safariMatch = navigator.userAgent.match(/Version\/(\d+)\.(\d+)/);
    const match = iosMatch || safariMatch;
    if (!match) return false;
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    return major > 16 || (major === 16 && minor >= 4);
  }
  return 'Notification' in window && 'serviceWorker' in navigator;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────
/**
 * usePush — FCM token lifecycle, permission state, multi-device token
 * management, foreground message handler, and preference-aware registration.
 *
 * @param {object} [identity]
 * @param {string} [identity.bookingCode] — booking code for guest token attribution
 * @param {string} [identity.staffId]     — staff UID for staff token attribution
 *
 * @returns {object}
 *   token          — current FCM token for this device, or null
 *   permission     — 'default' | 'granted' | 'denied'
 *   supported      — whether this device/browser can receive push at all
 *   pushCapable    — whether push is wirable right now (e.g. iOS needs install)
 *   platform       — 'ios' | 'android' | 'desktop' | 'unknown'
 *   standalone     — whether running as installed PWA
 *   foregroundMsg  — most recent foreground FCM payload, or null
 *   requestPermission(opts) — triggers browser prompt + saves token to Firestore
 *   revokeToken()  — deletes this device's token from Firestore
 */
export default function usePush({ bookingCode, staffId } = {}) {
  const [token, setToken] = useState(null);
  const [permission, setPermission] = useState('default');
  const [supported, setSupported] = useState(false);
  const [pushCapable, setPushCapable] = useState(false);
  const [platform, setPlatform] = useState('unknown');
  const [standalone, setStandalone] = useState(false);
  const [foregroundMsg, setForegroundMsg] = useState(null);

  // Stable ref so foreground unsub can be cleaned up
  const unsubForegroundRef = useRef(null);

  useEffect(() => {
    const cap = isPushCapable();
    const plat = detectPlatform();
    const sa = isStandalone();
    const notifSupported = typeof window !== 'undefined' && 'Notification' in window;

    setSupported(notifSupported);
    setPushCapable(cap);
    setPlatform(plat);
    setStandalone(sa);

    if (notifSupported) {
      setPermission(Notification.permission);
    }

    if (!cap) return;

    // Attach foreground message listener
    (async () => {
      const messaging = await getMessagingInstance();
      if (!messaging) return;

      try {
        const { onMessage } = await import('firebase/messaging');
        unsubForegroundRef.current = onMessage(messaging, (payload) => {
          console.info('[FCM] Foreground message:', payload);
          setForegroundMsg(payload);

          // Do NOT fire a raw new Notification() here — the app is open.
          // Callers should watch `foregroundMsg` and render an in-app toast.
        });
      } catch (err) {
        console.warn('[FCM] Could not attach foreground listener:', err);
      }
    })();

    // Auto-refresh token when permission is already granted.
    // Include identity fields so rotated tokens retain bookingCode/staffId.
    if (Notification.permission === 'granted') {
      (async () => {
        // Wait for Firebase Auth to restore session before writing to Firestore,
        // otherwise the write hits isAuthenticated() with null auth and is denied.
        const { auth } = await import('@/lib/firebase');
        await auth.authStateReady();
        if (!auth.currentUser) return;

        const msg = await getMessagingInstance();
        if (!msg) return;
        try {
          const { getToken: getFCMToken } = await import('firebase/messaging');
          const fcmToken = await getFCMToken(msg, {
            vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
          });
          if (fcmToken) {
            const refreshData = {
              token: fcmToken,
              updatedAt: new Date().toISOString(),
              platform: detectPlatform(),
              userAgent: navigator.userAgent,
            };
            if (bookingCode) refreshData.bookingCode = bookingCode;
            if (staffId) refreshData.staffId = staffId;

            await setDoc(
              doc(db, 'fcm_tokens', fcmToken),
              refreshData,
              { merge: true }
            );
            setToken(fcmToken);
          }
        } catch (err) {
          console.warn('[FCM] Token auto-refresh failed:', err);
        }
      })();
    }

    return () => {
      if (typeof unsubForegroundRef.current === 'function') {
        unsubForegroundRef.current();
      }
    };
  }, []);

  /**
   * Request push permission from the browser, obtain an FCM token, and write
   * it to Firestore under `fcm_tokens/{token}`.
   *
   * Stores either `bookingCode` (for guests) or `staffId` (for admin/staff)
   * so the server can target specific users.
   *
   * @param {object} [opts]
   * @param {string} [opts.bookingCode]
   * @param {string} [opts.staffId]
   */
  const requestPermission = useCallback(async ({ bookingCode, staffId } = {}) => {
    if (!isPushCapable()) return;

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;

      const messaging = await getMessagingInstance();
      if (!messaging) return;

      const { getToken } = await import('firebase/messaging');
      const fcmToken = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      });

      if (!fcmToken) {
        console.warn('[FCM] No registration token returned.');
        return;
      }

      const now = new Date().toISOString();
      const tokenData = {
        token: fcmToken,
        createdAt: now,
        updatedAt: now,
        userAgent: navigator.userAgent,
        platform: detectPlatform(),
      };
      if (bookingCode) tokenData.bookingCode = bookingCode;
      if (staffId) tokenData.staffId = staffId;

      await setDoc(doc(db, 'fcm_tokens', fcmToken), tokenData);
      setToken(fcmToken);
    } catch (err) {
      console.error('[FCM] requestPermission error:', err);
    }
  }, []);

  /**
   * Remove this device's FCM token from Firestore. Call on booking expiry
   * or explicit opt-out. Token becomes invalid on next FCM delivery attempt
   * anyway, but this keeps Firestore clean.
   *
   * @param {string} [targetToken] — defaults to the current token in state
   */
  const revokeToken = useCallback(async (targetToken) => {
    const t = targetToken || token;
    if (!t) return;
    try {
      await deleteDoc(doc(db, 'fcm_tokens', t));
      if (t === token) setToken(null);
    } catch (err) {
      console.warn('[FCM] revokeToken error:', err);
    }
  }, [token]);

  /**
   * Delete all Firestore FCM tokens associated with a booking code.
   * Intended for use when a booking expires or is cancelled.
   *
   * @param {string} bookingCode
   */
  const revokeAllTokensForBooking = useCallback(async (bookingCode) => {
    if (!bookingCode) return;
    try {
      const q = query(
        collection(db, 'fcm_tokens'),
        where('bookingCode', '==', bookingCode)
      );
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    } catch (err) {
      console.warn('[FCM] revokeAllTokensForBooking error:', err);
    }
  }, []);

  return {
    token,
    permission,
    supported,
    pushCapable,
    platform,
    standalone,
    foregroundMsg,
    requestPermission,
    revokeToken,
    revokeAllTokensForBooking,
  };
}
