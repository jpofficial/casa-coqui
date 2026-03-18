'use strict';

// ---------------------------------------------------------------------------
// index.js
//
// Main Cloud Functions entry point.
// Registers and exports all functions for Firebase deployment.
//
// Function summary:
//   parseReceipt  — HTTP trigger: inbound-email webhook → parse → Storage + Firestore
//   reorderCheck  — Scheduled: daily 9 AM PR time → check supply levels → notify admin
//   expireLinks   — Scheduled: daily 2 AM PR time → expire past-checkout bookings
//
// Deployment:
//   firebase deploy --only functions
//
// Local emulation:
//   firebase emulators:start --only functions
// ---------------------------------------------------------------------------

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');

const { parseReceiptHandler } = require('./parseReceipt');
const { reorderCheckHandler } = require('./reorderCheck');
const { expireLinksHandler } = require('./expireLinks');
const { cleaningReminderHandler } = require('./cleaningReminder');

// ---------------------------------------------------------------------------
// Global defaults
// Set the default region to us-east1 (closest to Puerto Rico) and pin memory.
// Individual functions can override these options.
// ---------------------------------------------------------------------------
setGlobalOptions({
  region: 'us-east1',
  memory: '256MiB',
  timeoutSeconds: 60,
});

// ---------------------------------------------------------------------------
// parseReceipt
//
// HTTP trigger. Receives multipart/form-data from SendGrid Inbound Parse or
// Mailgun Routes. Processes attachments → Cloud Storage → Firestore.
//
// Webhook URL after deployment:
//   https://us-east1-{project-id}.cloudfunctions.net/parseReceipt
//
// Register this URL in your email service's inbound routing settings.
// ---------------------------------------------------------------------------
exports.parseReceipt = onRequest(
  {
    // Allow larger request bodies for email attachments (default is 10 MB).
    maxInstances: 5,
    memory: '512MiB',
    timeoutSeconds: 120,
    // Disable CORS — this is only called by the email service, not the browser.
    cors: false,
    // Allow unauthenticated requests: the email service cannot pass Firebase tokens.
    // Protect this endpoint by validating a shared secret in the webhook settings
    // or via SendGrid's signed webhooks.
    invoker: 'public',
  },
  async (req, res) => {
    try {
      await parseReceiptHandler(req, res);
    } catch (err) {
      logger.error('[parseReceipt] Unhandled error:', err);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// ---------------------------------------------------------------------------
// reorderCheck
//
// Scheduled function: runs daily at 9:00 AM in the property timezone.
// America/Puerto_Rico is UTC-4 (no DST), so 9 AM PR = 13:00 UTC.
//
// To also trigger manually via the Firebase Console or gcloud CLI:
//   gcloud scheduler jobs run reorderCheck --location us-east1
// ---------------------------------------------------------------------------
exports.reorderCheck = onSchedule(
  {
    schedule: '0 13 * * *', // 09:00 America/Puerto_Rico (UTC-4)
    timeZone: 'America/Puerto_Rico',
    retryCount: 2,
    memory: '256MiB',
  },
  async (event) => {
    logger.info('[reorderCheck] Scheduled trigger fired', { eventId: event.jobName });
    try {
      const result = await reorderCheckHandler();
      logger.info('[reorderCheck] Completed', result);
    } catch (err) {
      logger.error('[reorderCheck] Unhandled error:', err);
      // Re-throw so Firebase retries the invocation (up to retryCount times).
      throw err;
    }
  }
);

// ---------------------------------------------------------------------------
// expireLinks
//
// Scheduled function: runs daily at 2:00 AM in the property timezone.
// America/Puerto_Rico UTC-4 → 2 AM PR = 06:00 UTC.
//
// Runs at 2 AM so that guests have the full checkout day (typically 11 AM)
// before the link is marked expired on the *following* run.
// ---------------------------------------------------------------------------
exports.expireLinks = onSchedule(
  {
    schedule: '0 6 * * *', // 02:00 America/Puerto_Rico (UTC-4)
    timeZone: 'America/Puerto_Rico',
    retryCount: 2,
    memory: '256MiB',
  },
  async (event) => {
    logger.info('[expireLinks] Scheduled trigger fired', { eventId: event.jobName });
    try {
      const result = await expireLinksHandler();
      logger.info('[expireLinks] Completed', result);
    } catch (err) {
      logger.error('[expireLinks] Unhandled error:', err);
      throw err;
    }
  }
);

// ---------------------------------------------------------------------------
// cleaningReminder
//
// Scheduled function: runs daily at 6:00 PM in the property timezone.
// Sends a reminder push to cleaners with jobs scheduled for the next day.
//
// 6 PM PR = 22:00 UTC (UTC-4).
// ---------------------------------------------------------------------------
exports.cleaningReminder = onSchedule(
  {
    schedule: '0 22 * * *', // 18:00 America/Puerto_Rico (UTC-4)
    timeZone: 'America/Puerto_Rico',
    retryCount: 2,
    memory: '256MiB',
  },
  async (event) => {
    logger.info('[cleaningReminder] Scheduled trigger fired', { eventId: event.jobName });
    try {
      const result = await cleaningReminderHandler();
      logger.info('[cleaningReminder] Completed', result);
    } catch (err) {
      logger.error('[cleaningReminder] Unhandled error:', err);
      throw err;
    }
  }
);
