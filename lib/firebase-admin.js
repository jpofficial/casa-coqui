import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '""');
} catch (e) {
  console.error('[firebase-admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e.message);
  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT_KEY environment variable is missing or contains invalid JSON. ' +
    'Ensure it is set correctly in your deployment environment.'
  );
}

if (!serviceAccount || typeof serviceAccount !== 'object' || !serviceAccount.project_id) {
  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT_KEY is empty or missing required fields (e.g. project_id). ' +
    'Check your environment variables.'
  );
}

const adminApp =
  getApps().length === 0
    ? initializeApp({
        credential: cert(serviceAccount),
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      })
    : getApps()[0];

export const adminDb = getFirestore(adminApp);
export const adminAuth = getAuth(adminApp);
export const adminStorage = getStorage(adminApp);
export default adminApp;
