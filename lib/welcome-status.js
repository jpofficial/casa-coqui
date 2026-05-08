const WELCOME_STATUSES = {
  PENDING: 'pending',
  READY: 'ready',
  SNOOZED: 'snoozed',
  SENT: 'sent',
  SKIPPED: 'skipped',
  ERROR: 'error',
};

/** Only 'ready' welcomes appear in the Drafts tab / are actionable via Mark-Sent. */
function isActionable(status) {
  return status === WELCOME_STATUSES.READY;
}

/**
 * Default Send-later timestamp: 9:00 AM local time on the day before check-in.
 * Returns null if checkInDate is missing/invalid.
 */
function computeDefaultSnoozeIso(checkInDate) {
  if (!checkInDate) return null;
  // checkInDate is a yyyy-mm-dd string stored in Firestore.
  const parts = String(checkInDate).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  const target = new Date(y, m - 1, d - 1, 9, 0, 0, 0); // local time
  if (Number.isNaN(target.getTime())) return null;
  return target.toISOString();
}

/** True when a booking is still 'pending' more than 10 minutes after creation. */
function isStuckPending(status, bookingCreatedAt) {
  if (status !== WELCOME_STATUSES.PENDING) return false;
  if (!bookingCreatedAt) return false;
  const createdMs = new Date(bookingCreatedAt).getTime();
  if (Number.isNaN(createdMs)) return false;
  return Date.now() - createdMs > 10 * 60 * 1000;
}

module.exports = {
  WELCOME_STATUSES,
  isActionable,
  computeDefaultSnoozeIso,
  isStuckPending,
};
