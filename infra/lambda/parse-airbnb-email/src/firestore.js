'use strict';

/**
 * Firebase Admin bootstrap for the Lambda — lazy, cached per container.
 * The service-account JSON is fetched once from Secrets Manager.
 */

const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const admin = require('firebase-admin');

// Module-level — reused across warm invocations.
const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// ---------------------------------------------------------------------------
// Firebase Admin — lazy initialisation, module-level cache
// ---------------------------------------------------------------------------

/** @type {import('firebase-admin').app.App | null} */
let firebaseApp = null;

/** @type {import('firebase-admin').firestore.Firestore | null} */
let db = null;

/**
 * Initialise (or return the cached) Firebase Admin app.
 * Service-account JSON is fetched once from Secrets Manager per container.
 */
async function getFirestore() {
  if (db) return db;

  const secretName =
    process.env.FIREBASE_SECRET_NAME || 'casa-coqui/firebase-service-account';

  const secretResponse = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );

  const serviceAccount = JSON.parse(secretResponse.SecretString);

  // Guard: only call initializeApp once per container lifetime
  if (!admin.apps.length) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    firebaseApp = admin.apps[0];
  }

  db = admin.firestore(firebaseApp);
  return db;
}

/**
 * The Firebase Admin app initialised by getFirestore(). Callers that need
 * other Admin services (e.g. messaging) must have awaited getFirestore()
 * first — exactly the ordering the handler has always had.
 */
function getFirebaseApp() {
  return firebaseApp;
}

module.exports = { getFirestore, getFirebaseApp };
