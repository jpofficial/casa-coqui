'use strict';

// ---------------------------------------------------------------------------
// firebaseInit.js
//
// Initializes Firebase Admin SDK once and exports shared service handles.
// All Cloud Functions import from here so the SDK is only initialized once
// per cold-start, regardless of how many functions run in the same instance.
// ---------------------------------------------------------------------------

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { getMessaging } = require('firebase-admin/messaging');

// The service account key is stored as a JSON string in the environment.
// When deploying to Firebase, set this via:
//   firebase functions:config:set app.service_account_key='{"type":"service_account",...}'
// Or set FIREBASE_SERVICE_ACCOUNT_KEY directly in the Functions runtime environment.
function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    // Not fatal — Cloud Functions runtime uses Application Default
    // Credentials (ADC) automatically. The env var is only needed for
    // local development and non-GCP environments (e.g. Vercel).
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('[firebase-admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', err.message);
    return null;
  }
}

// Initialize once; subsequent calls reuse the existing app.
let adminApp;
if (getApps().length === 0) {
  const serviceAccount = getServiceAccount();
  const config = {};
  if (serviceAccount) {
    config.credential = cert(serviceAccount);
  }
  if (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
    config.storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  }
  adminApp = initializeApp(config);
} else {
  adminApp = getApps()[0];
}

const db = getFirestore(adminApp);
const storage = getStorage(adminApp);
const messaging = getMessaging(adminApp);

module.exports = { adminApp, db, storage, messaging };
