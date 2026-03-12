'use client';

import { useState, useEffect } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import app from '@/lib/firebase';

// Lazily resolve the messaging instance so this module is safe to import on
// the server and in browsers that don't support the Notifications API.
let messagingInstance = null;

async function getMessagingInstance() {
  if (messagingInstance) return messagingInstance;
  if (typeof window === 'undefined' || !('Notification' in window)) return null;

  try {
    const { getMessaging } = await import('firebase/messaging');
    messagingInstance = getMessaging(app);
    return messagingInstance;
  } catch (err) {
    console.warn('Firebase Messaging is not supported in this browser:', err);
    return null;
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────────
export default function usePush() {
  const [token, setToken] = useState(null);
  const [permission, setPermission] = useState('default');
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setSupported(false);
      return;
    }

    setSupported(true);
    setPermission(Notification.permission);

    // Listen for foreground messages without blocking the effect
    let unsubscribeForeground = null;

    (async () => {
      const messaging = await getMessagingInstance();
      if (!messaging) return;

      try {
        const { onMessage } = await import('firebase/messaging');
        unsubscribeForeground = onMessage(messaging, (payload) => {
          // Show a simple browser notification if the tab is focused.
          // A production app would use a toast library here.
          console.info('[FCM] Foreground message received:', payload);
          const { title, body } = payload.notification ?? {};
          if (title && Notification.permission === 'granted') {
            new Notification(title, { body: body ?? '', icon: '/icons/icon-192.png' });
          }
        });
      } catch (err) {
        console.warn('[FCM] Could not subscribe to foreground messages:', err);
      }
    })();

    return () => {
      if (typeof unsubscribeForeground === 'function') {
        unsubscribeForeground();
      }
    };
  }, []);

  /**
   * Asks the user for notification permission, retrieves the FCM registration
   * token, and saves it to Firestore under `fcm_tokens/{token}`.
   *
   * @param {object} opts
   * @param {string} [opts.bookingCode] - The guest's booking code (for targeted push)
   * @param {string} [opts.staffId]     - Staff UID (for staff push notifications)
   *
   * Safe to call multiple times — re-requests only when permission is not yet
   * granted.
   */
  async function requestPermission({ bookingCode, staffId } = {}) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

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

      // Persist the token so the server can send targeted pushes
      const tokenData = {
        token: fcmToken,
        createdAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
      };
      if (bookingCode) tokenData.bookingCode = bookingCode;
      if (staffId) tokenData.staffId = staffId;

      await setDoc(doc(db, 'fcm_tokens', fcmToken), tokenData);

      setToken(fcmToken);
    } catch (err) {
      console.error('[FCM] requestPermission error:', err);
    }
  }

  return { token, permission, requestPermission, supported };
}
