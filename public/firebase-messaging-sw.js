/* eslint-disable no-undef */
// Firebase Messaging Service Worker
// Handles background push notifications when the app is not focused.
// Version 2 — FCM-first, deep-linking, notification grouping, badge API.

importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging-compat.js');

// These are the public Firebase config values (not secrets — they identify the
// project and are safe to ship in the service worker).
firebase.initializeApp({
  apiKey: 'AIzaSyDNqAlip2cwIcEA4ub4_eKyejq8suMpnqI',
  authDomain: 'casa-coqui.firebaseapp.com',
  projectId: 'casa-coqui',
  storageBucket: 'casa-coqui.firebasestorage.app',
  messagingSenderId: '145265817310',
  appId: '1:145265817310:web:52614bf426a571aa6eb44f',
});

const messaging = firebase.messaging();

// ─── Category → deep-link path mapping ───────────────────────────────────────
// The `data` object in a FCM payload carries `type`, `bookingCode`, and
// optional `targetPath` fields so this SW can route to the right screen.
//
// Payload data fields:
//   type         — category key (see CATEGORY_PATHS below)
//   bookingCode  — guest's booking code (for guest-targeted pushes)
//   targetPath   — explicit override path (takes precedence over type)
//
// For staff notifications `bookingCode` is absent — the SW opens /admin.

const CATEGORY_PATHS = {
  parking: (code) => code ? `/g/${code}/parking` : '/admin/community',
  laundry: (code) => code ? `/g/${code}/laundry` : '/admin',
  laundry_available: (code) => code ? `/g/${code}/laundry` : '/admin',
  maintenance: (code) => code ? `/g/${code}/maintenance` : '/admin/maintenance',
  community: (code) => code ? `/g/${code}/community` : '/admin/community',
  message: (code) => code ? `/g/${code}` : '/admin/messages',
  announcement: (code) => code ? `/g/${code}` : '/admin',
  checkin: (code) => code ? `/g/${code}/checkin` : '/admin/stays',
  general: (code) => code ? `/g/${code}` : '/admin',
  cleaning_assignment: () => '/admin/cleaning',
  cleaning_update: () => '/admin/cleaning',
};

function resolveDeepLink(data) {
  if (!data) return '/';
  if (data.targetPath) return data.targetPath;
  const { type, bookingCode } = data;
  const pathFn = CATEGORY_PATHS[type] || CATEGORY_PATHS.general;
  return pathFn(bookingCode || null);
}

// ─── Category → notification tag (for grouping) ───────────────────────────────
// Notifications with the same tag replace each other in the tray.
// We group by category so multiple parking alerts collapse into one.
function resolveTag(data) {
  if (!data) return 'general';
  // Use bookingCode in tag so guests don't collide with each other
  const prefix = data.bookingCode ? `guest-${data.bookingCode}` : 'staff';
  return `${prefix}-${data.type || 'general'}`;
}

// ─── Background message handler ───────────────────────────────────────────────
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  if (!title) return;

  const data = payload.data || {};
  const tag = resolveTag(data);

  // Notification actions vary by category
  const actions = buildActions(data.type);

  const options = {
    body: body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72.png',
    tag,
    renotify: true,           // vibrate / alert even if replacing same tag
    requireInteraction: false,
    data: {
      url: resolveDeepLink(data),
      ...data,
    },
  };

  if (actions.length) {
    options.actions = actions;
  }

  self.registration.showNotification(title, options);

  // Update the app badge count if the Badge API is available
  if ('setAppBadge' in navigator) {
    // We don't have the unread count here; increment by 1 and let the app
    // clear it via clearAppBadge() when the user opens the center.
    navigator.setAppBadge().catch(() => {});
  }
});

// ─── Notification action buttons by category ─────────────────────────────────
function buildActions(type) {
  switch (type) {
    case 'laundry':
      return [{ action: 'view', title: 'Check Status' }];
    case 'maintenance':
      return [{ action: 'view', title: 'View Request' }];
    case 'parking':
      return [{ action: 'view', title: 'View Map' }];
    case 'cleaning_assignment':
      return [{ action: 'view', title: 'Ver Limpieza' }];
    case 'cleaning_update':
      return [{ action: 'view', title: 'Ver Limpieza' }];
    default:
      return [];
  }
}

// ─── Notification click handler ───────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // `event.action` is set when an action button was tapped; for a plain tap
  // it is an empty string.
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing window if the URL matches
        for (const client of clientList) {
          const clientOrigin = new URL(client.url).origin;
          const swOrigin = self.location.origin;
          if (clientOrigin === swOrigin && 'focus' in client) {
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              url: targetUrl,
            });
            return client.focus();
          }
        }
        // No matching window — open a new one
        return clients.openWindow(targetUrl);
      })
  );

  // Clear the badge once the user interacts
  if ('clearAppBadge' in navigator) {
    navigator.clearAppBadge().catch(() => {});
  }
});

// ─── Push event (raw — fallback for non-FCM pushes) ──────────────────────────
self.addEventListener('push', (event) => {
  // FCM messages are handled by onBackgroundMessage above.
  // This handler is a safety net for any raw Web Push payloads.
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  // If this already has a notification key it was likely shown by FCM SDK
  if (payload.notification) return;

  const { title, body, type, bookingCode } = payload;
  if (!title) return;

  const data = { type, bookingCode };
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body || '',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72.png',
      tag: resolveTag(data),
      data: { url: resolveDeepLink(data), ...data },
    })
  );
});
