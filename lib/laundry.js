import { sendNotification, isQuietHours } from '@/lib/notifications';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default session durations in minutes, keyed by machineId */
export const SESSION_DURATIONS = { washer: 40, dryer: 60 };

/** All valid machine IDs */
export const MACHINE_IDS = ['washer', 'dryer'];

// ---------------------------------------------------------------------------
// notifyWaitlist
//
// Finds all 'waiting' waitlist entries for a machine whose expiresAt is still
// in the future, sends each guest a notification (FCM via bookingCode, or SMS
// from the guests collection), then marks each entry as 'notified'.
//
// This function is fire-and-forget safe — callers should not await it if they
// don't want to block the response.
//
// @param {FirebaseFirestore.Firestore} db
// @param {string} machineId
// ---------------------------------------------------------------------------
export async function notifyWaitlist(db, machineId) {
  try {
    // Suppress waitlist notifications during quiet hours.
    // Entries stay as 'waiting' so they fire on the next non-quiet-hours release.
    if (isQuietHours()) {
      console.log(`[notifyWaitlist] Suppressed — quiet hours active`);
      return;
    }

    const now = new Date().toISOString();

    const waitlistSnap = await db
      .collection('laundry_waitlist')
      .where('machineId', '==', machineId)
      .where('status', '==', 'waiting')
      .get();

    if (waitlistSnap.empty) return;

    const machineName = machineId.charAt(0).toUpperCase() + machineId.slice(1);
    const title = `${machineName} is free`;
    const body = `The ${machineName.toLowerCase()} is now available. Tap to start your session.`;

    const batch = db.batch();

    for (const doc of waitlistSnap.docs) {
      const entry = doc.data();

      // Skip entries that have already expired
      if (entry.expiresAt <= now) {
        batch.update(doc.ref, { status: 'expired', updatedAt: now });
        continue;
      }

      // Try to find an FCM token for this bookingCode first
      let notificationTarget = null;

      if (entry.bookingCode) {
        const tokenSnap = await db
          .collection('fcm_tokens')
          .where('bookingCode', '==', entry.bookingCode)
          .limit(1)
          .get();

        if (!tokenSnap.empty) {
          notificationTarget = tokenSnap.docs[0].data().token;
        }
      }

      // Fall back to guest phone number
      if (!notificationTarget && entry.bookingCode) {
        const guestSnap = await db
          .collection('guests')
          .where('bookingCode', '==', entry.bookingCode)
          .limit(1)
          .get();

        if (!guestSnap.empty) {
          const guest = guestSnap.docs[0].data();
          if (guest.phone) {
            notificationTarget = guest.phone;
          }
        }
      }

      if (notificationTarget) {
        sendNotification({
          to: notificationTarget,
          title,
          body,
          data: { machineId, type: 'laundry_available' },
        }).then((result) => {
          if (result.staleToken && entry.bookingCode) {
            // Clean up the stale FCM token doc
            db.collection('fcm_tokens')
              .where('bookingCode', '==', entry.bookingCode)
              .limit(1)
              .get()
              .then((snap) => {
                if (!snap.empty) snap.docs[0].ref.delete();
              })
              .catch((err) => {
                console.error('[notifyWaitlist] Stale token cleanup error:', err);
              });
          }
        }).catch((err) => {
          console.error(`[notifyWaitlist] Failed to notify ${entry.guestId}:`, err);
        });
      }

      batch.update(doc.ref, {
        status: 'notified',
        notifiedAt: now,
        updatedAt: now,
      });
    }

    await batch.commit();
  } catch (error) {
    console.error('[notifyWaitlist] Error:', error);
  }
}

// ---------------------------------------------------------------------------
// autoReleaseIfExpired
//
// Checks whether a machine's active session has passed its expiresAt time.
// If so, runs a Firestore transaction to:
//   1. Mark the session document as completed/expired
//   2. Reset the machine document to 'available'
// Then notifies any waiting guests via notifyWaitlist.
//
// @param {FirebaseFirestore.Firestore} db
// @param {string} machineId
// @returns {Promise<{ released: boolean, machineId?: string }>}
// ---------------------------------------------------------------------------
export async function autoReleaseIfExpired(db, machineId) {
  try {
    const machineRef = db.collection('laundry').doc(machineId);
    const machineDoc = await machineRef.get();

    if (!machineDoc.exists) return { released: false };

    const machine = machineDoc.data();

    if (machine.status !== 'in_use') return { released: false };

    const now = new Date().toISOString();
    if (!machine.sessionExpiresAt || machine.sessionExpiresAt > now) {
      return { released: false };
    }

    // Session has expired — run a transaction to atomically release the machine
    // and close the session document.
    const activeSessionId = machine.activeSessionId;

    await db.runTransaction(async (tx) => {
      // Re-read machine inside the transaction for consistency
      const freshMachineDoc = await tx.get(machineRef);
      const freshMachine = freshMachineDoc.data();

      // Another process may have already released it
      if (
        !freshMachineDoc.exists ||
        freshMachine.status !== 'in_use' ||
        freshMachine.sessionExpiresAt > now
      ) {
        return;
      }

      const endedAt = new Date().toISOString();

      // Update the machine back to available
      tx.update(machineRef, {
        status: 'available',
        activeSessionId: null,
        sessionStartedAt: null,
        sessionExpiresAt: null,
        sessionOwnerId: null,
        sessionOwnerName: null,
        sessionBookingCode: null,
        updatedAt: endedAt,
        updatedBy: 'system',
        updatedByRole: 'system',
      });

      // Close the session document if it exists
      if (activeSessionId) {
        const sessionRef = db.collection('laundry_sessions').doc(activeSessionId);
        tx.update(sessionRef, {
          status: 'completed',
          endedAt,
          endedBy: 'system',
          endedByRole: 'system',
          endReason: 'expired',
        });
      }
    });

    // After transaction succeeds, notify any waiting guests (fire-and-forget)
    notifyWaitlist(db, machineId).catch((err) => {
      console.error('[autoReleaseIfExpired] notifyWaitlist error:', err);
    });

    return { released: true, machineId };
  } catch (error) {
    console.error(`[autoReleaseIfExpired] Error for ${machineId}:`, error);
    return { released: false };
  }
}
