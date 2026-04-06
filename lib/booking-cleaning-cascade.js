// ---------------------------------------------------------------------------
// booking-cleaning-cascade.js
//
// When a booking's checkOutDate changes, cascade the update to linked
// cleaning_jobs. Respects manual overrides and in-progress jobs.
// ---------------------------------------------------------------------------
import { adminDb } from '@/lib/firebase-admin';
import { notifyStaff, notifyAdminAndCohost } from '@/lib/staff-notifications';
import { nt } from '@/lib/notification-strings';

const HISTORICAL_STATUSES = ['completed', 'archived', 'deleted', 'cancelled'];
const IN_PROGRESS_STATUSES = [
  'en_route', 'arrived', 'before_photos', 'cleaning', 'after_photos', 'laundry_check',
];
const RESCHEDULABLE_STATUSES = ['scheduled', 'acknowledged', 'declined'];

/**
 * Cascade a checkout-date change to linked cleaning jobs.
 *
 * @param {object} opts
 * @param {string} opts.bookingId        Firestore doc ID of the booking
 * @param {string} opts.newCheckOutDate   New checkout date (YYYY-MM-DD)
 * @param {string} opts.oldCheckOutDate   Previous checkout date (YYYY-MM-DD)
 * @param {string} opts.unit              Unit name (for notification text)
 * @param {string} [opts.guestName]       Guest name (for notification text)
 * @returns {{ updated: number, skippedOverride: number, skippedInProgress: number, skippedHistorical: number }}
 */
export async function cascadeCleaningJobDates({
  bookingId,
  newCheckOutDate,
  oldCheckOutDate,
  unit,
  guestName = '',
}) {
  const result = { updated: 0, skippedOverride: 0, skippedInProgress: 0, skippedHistorical: 0 };

  if (!bookingId || !newCheckOutDate) return result;
  if (newCheckOutDate === oldCheckOutDate) return result;

  const jobsSnap = await adminDb
    .collection('cleaning_jobs')
    .where('bookingId', '==', bookingId)
    .get();

  if (jobsSnap.empty) return result;

  const now = new Date().toISOString();

  for (const jobDoc of jobsSnap.docs) {
    const job = jobDoc.data();

    // 1. Skip historical jobs
    if (HISTORICAL_STATUSES.includes(job.status)) {
      result.skippedHistorical++;
      continue;
    }

    // 2. Skip in-progress jobs — warn admin
    if (IN_PROGRESS_STATUSES.includes(job.status)) {
      result.skippedInProgress++;
      await notifyAdminAndCohost({
        title: nt('en', 'cleaningInProgressWarning_title'),
        body: nt('en', 'cleaningInProgressWarning_body', { unit, oldDate: oldCheckOutDate, newDate: newCheckOutDate }),
        type: 'cleaning_update',
        data: { jobId: jobDoc.id, targetPath: '/admin/cleaning' },
        localizer: (locale) => ({
          title: nt(locale, 'cleaningInProgressWarning_title'),
          body: nt(locale, 'cleaningInProgressWarning_body', { unit, oldDate: oldCheckOutDate, newDate: newCheckOutDate }),
        }),
      }).catch((err) => console.error('[cascade] In-progress notify error:', err));
      continue;
    }

    // 3. Skip manually overridden jobs — notify admin override held
    if (job.manualOverride === true) {
      result.skippedOverride++;
      await notifyAdminAndCohost({
        title: nt('en', 'cleaningOverrideHeld_title'),
        body: nt('en', 'cleaningOverrideHeld_body', { unit, oldDate: oldCheckOutDate, newDate: newCheckOutDate }),
        type: 'cleaning_update',
        data: { jobId: jobDoc.id, targetPath: '/admin/cleaning' },
        localizer: (locale) => ({
          title: nt(locale, 'cleaningOverrideHeld_title'),
          body: nt(locale, 'cleaningOverrideHeld_body', { unit, oldDate: oldCheckOutDate, newDate: newCheckOutDate }),
        }),
      }).catch((err) => console.error('[cascade] Override notify error:', err));
      continue;
    }

    // 4. Reschedulable jobs — update date and reset status
    if (RESCHEDULABLE_STATUSES.includes(job.status) && job.scheduledDate !== newCheckOutDate) {
      const updates = {
        scheduledDate: newCheckOutDate,
        status: 'scheduled',
        acknowledgedAt: null,
        declinedAt: null,
        declineReason: null,
        updatedAt: now,
      };

      // Update guest name in notes if provided
      if (guestName) {
        updates.notes = `Guest: ${guestName}`;
      }

      await jobDoc.ref.update(updates);
      result.updated++;

      // Notify assigned cleaner
      if (job.assigneeId) {
        await notifyStaff({
          staffIds: [job.assigneeId],
          title: nt('en', 'cleaningDateChanged_title'),
          body: nt('en', 'cleaningDateChanged_body', { unit, oldDate: oldCheckOutDate, newDate: newCheckOutDate }),
          type: 'cleaning_update',
          data: { jobId: jobDoc.id, unit, scheduledDate: newCheckOutDate, targetPath: '/admin/cleaning' },
          localizer: (locale) => ({
            title: nt(locale, 'cleaningDateChanged_title'),
            body: nt(locale, 'cleaningDateChanged_body', { unit, oldDate: oldCheckOutDate, newDate: newCheckOutDate }),
          }),
        }).catch((err) => console.error('[cascade] Cleaner notify error:', err));
      }
    }
  }

  console.log(`[cascadeCleaningJobDates] bookingId=${bookingId} updated=${result.updated} skippedOverride=${result.skippedOverride} skippedInProgress=${result.skippedInProgress} skippedHistorical=${result.skippedHistorical}`);
  return result;
}
