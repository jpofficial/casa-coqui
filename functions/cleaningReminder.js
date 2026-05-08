'use strict';

// ---------------------------------------------------------------------------
// cleaningReminder.js
//
// Scheduled Cloud Function — runs daily at 6 PM PR time (evening before).
// Sends a reminder push to cleaners with jobs scheduled for tomorrow.
//
// Logic:
//   1. Compute tomorrow's date string (YYYY-MM-DD).
//   2. Query cleaning_jobs where scheduledDate == tomorrow and status in
//      ['scheduled', 'acknowledged'] and reminderSentAt is null.
//   3. For each job, look up FCM tokens via fcm_tokens where staffId matches.
//   4. Resolve cleaner locale from users/{assigneeId}.locale (default 'es').
//   5. Send data-only FCM push (no notification key).
//   6. Write staff_notifications doc for in-app history.
//   7. Set reminderSentAt + updatedAt on the job doc to prevent duplicates.
// ---------------------------------------------------------------------------

const { db, messaging } = require('./firebaseInit');

// Hardcoded notification strings (CommonJS — can't import ES module)
const STRINGS = {
  es: {
    title: 'Recordatorio de limpieza mañana',
    body: '{unit} — checkout {time}',
  },
  en: {
    title: 'Cleaning Reminder — Tomorrow',
    body: '{unit} — checkout {time}',
  },
};

function interpolate(template, params) {
  return Object.entries(params).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, v),
    template
  );
}

/**
 * Main handler — called by the scheduled Cloud Function in index.js.
 *
 * @returns {Promise<{ checked: number, reminded: number }>}
 */
async function cleaningReminderHandler() {
  // Compute tomorrow's date in PR timezone (UTC-4, no DST)
  const now = new Date();
  const prOffset = -4 * 60; // minutes
  const prTime = new Date(now.getTime() + (prOffset + now.getTimezoneOffset()) * 60000);
  prTime.setDate(prTime.getDate() + 1);
  const tomorrow = prTime.toISOString().split('T')[0];

  console.log(`[cleaningReminder] Looking for jobs on ${tomorrow}`);

  // Query jobs for tomorrow that haven't been reminded yet
  const jobsSnap = await db
    .collection('cleaning_jobs')
    .where('scheduledDate', '==', tomorrow)
    .where('status', 'in', ['scheduled', 'acknowledged'])
    .get();

  // Post-filter: skip jobs that already have reminderSentAt
  const jobs = jobsSnap.docs.filter((d) => !d.data().reminderSentAt);

  console.log(`[cleaningReminder] Found ${jobs.length} job(s) to remind`);

  let reminded = 0;

  for (const jobDoc of jobs) {
    const job = jobDoc.data();
    const { assigneeId, unit, checkoutTime } = job;
    if (!assigneeId) continue;

    try {
      // Resolve cleaner locale
      const userDoc = await db.collection('users').doc(assigneeId).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const locale = (userData.locale === 'en') ? 'en' : 'es'; // default es for cleaners

      // Build localized content
      const strings = STRINGS[locale];
      const title = strings.title;
      const body = interpolate(strings.body, {
        unit: unit || '',
        time: checkoutTime || '11:00 AM',
      });

      // Look up FCM tokens for this staff member
      const tokensSnap = await db
        .collection('fcm_tokens')
        .where('staffId', '==', assigneeId)
        .get();

      // Send push to each token
      const pushPromises = tokensSnap.docs.map((tokenDoc) => {
        const { token } = tokenDoc.data();
        if (!token) return Promise.resolve();
        return messaging.send({
          token,
          data: {
            title,
            body,
            type: 'cleaning_reminder',
            jobId: jobDoc.id,
            unit: unit || '',
            scheduledDate: tomorrow,
            targetPath: '/admin/cleaning',
          },
        }).catch((err) => {
          console.error(`[cleaningReminder] FCM send error for ${assigneeId}:`, err.message);
        });
      });

      await Promise.all(pushPromises);

      // Write staff_notifications doc for in-app history
      const now2 = new Date().toISOString();
      await db.collection('staff_notifications').add({
        recipientId: assigneeId,
        title,
        body,
        type: 'cleaning_reminder',
        data: {
          jobId: jobDoc.id,
          unit: unit || '',
          scheduledDate: tomorrow,
          targetPath: '/admin/cleaning',
        },
        read: false,
        createdAt: now2,
      });

      // Mark job as reminded
      await jobDoc.ref.update({
        reminderSentAt: now2,
        updatedAt: now2,
      });

      reminded++;
      console.log(`[cleaningReminder] Reminded ${assigneeId} about ${unit} on ${tomorrow}`);
    } catch (err) {
      console.error(`[cleaningReminder] Error processing job ${jobDoc.id}:`, err);
    }
  }

  return { checked: jobsSnap.size, reminded };
}

module.exports = { cleaningReminderHandler };
