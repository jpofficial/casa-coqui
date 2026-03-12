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
    throw new Error(
      'Missing required env var: FIREBASE_SERVICE_ACCOUNT_KEY. ' +
      'Set it in .env for the emulator or in Firebase function config for production.'
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON: ' + err.message);
  }
}

// Initialize once; subsequent calls reuse the existing app.
let adminApp;
if (getApps().length === 0) {
  const serviceAccount = getServiceAccount();
  adminApp = initializeApp({
    credential: cert(serviceAccount),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
} else {
  adminApp = getApps()[0];
}

const db = getFirestore(adminApp);
const storage = getStorage(adminApp);
const messaging = getMessaging(adminApp);

module.exports = { adminApp, db, storage, messaging };
