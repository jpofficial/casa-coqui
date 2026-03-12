/* eslint-disable no-undef */
// Firebase Messaging Service Worker
// Handles background push notifications when the app is not focused.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// These values are public Firebase config (they identify the project, not secrets).
firebase.initializeApp({
  apiKey: 'AIzaSyDNqAlip2cwIcEA4ub4_eKyejq8suMpnqI',
  authDomain: 'casa-coqui.firebaseapp.com',
  projectId: 'casa-coqui',
  storageBucket: 'casa-coqui.firebasestorage.app',
  messagingSenderId: '145265817310',
  appId: '1:145265817310:web:52614bf426a571aa6eb44f',
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  if (!title) return;

  const notificationOptions = {
    body: body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.data?.type || 'general',
  };

  self.registration.showNotification(title, notificationOptions);
});

// Handle notification click — open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/admin');
    })
  );
});
