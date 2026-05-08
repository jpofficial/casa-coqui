'use strict';

// ---------------------------------------------------------------------------
// expireLinks.js
//
// Scheduled Cloud Function — runs daily (default: 2 AM America/Puerto_Rico).
//
// Logic:
//   1. Query all bookings where status == 'active'.
//   2. For each booking, parse checkOutDate and compare it with "today" in the
//      property timezone (America/Puerto_Rico, UTC-4 / UTC-3 DST).
//      We use Date comparison: if checkout midnight has already passed, the
//      booking is expired.
//   3. For expired bookings: update status to 'completed' and set linkExpired
//      to true.
//   4. Return a summary: { expired, checked }.
//
// Firestore `bookings` document shape:
//   code          {string}   unique booking code
//   unit          {string}   unit identifier
//   guestName     {string}   guest display name
//   checkInDate   {string}   ISO date string (YYYY-MM-DD or full ISO)
//   checkOutDate  {string}   ISO date string — expiry is end of this day
//   status        {string}   'active' | 'completed' | 'cancelled'
//   checkedIn     {boolean}
//   createdAt     {string}   ISO timestamp
//   guestLink     {string}   URL shared with the guest
//   linkExpired   {boolean}  set to true by this function when expired
// ---------------------------------------------------------------------------

const { db } = require('./firebaseInit');

// Property timezone: America/Puerto_Rico (UTC-4, no DST)
const PROPERTY_TZ = 'America/Puerto_Rico';

/**
 * Returns "today's date" as a YYYY-MM-DD string in the property timezone.
 * We use Intl.DateTimeFormat to avoid external dependencies.
 *
 * @returns {string}  e.g. "2026-03-11"
 */
function todayInPropertyTz() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PROPERTY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA locale formats as YYYY-MM-DD which is exactly what we want.
  return formatter.format(new Date());
}

/**
 * Normalizes a checkout date value from Firestore into a YYYY-MM-DD string.
 * Accepts:
 *   - A Firestore Timestamp object (with .toDate())
 *   - An ISO string like "2026-03-15" or "2026-03-15T00:00:00Z"
 *   - A plain Date object
 * Returns null if the value cannot be parsed.
 *
 * @param {any} rawDate
 * @returns {string|null}
 */
function normalizeCheckoutDate(rawDate) {
  if (!rawDate) return null;

  let date;

  // Firestore Timestamp
  if (typeof rawDate.toDate === 'function') {
    date = rawDate.toDate();
  } else if (rawDate instanceof Date) {
    date = rawDate;
  } else if (typeof rawDate === 'string') {
    // Accept YYYY-MM-DD directly without conversion to avoid TZ shifts.
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return rawDate; // Already in target format.
    }
    date = new Date(rawDate);
  } else {
    return null;
  }

  if (isNaN(date.getTime())) return null;

  // Format as YYYY-MM-DD in property timezone for accurate comparison.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PROPERTY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Main handler — called by the scheduled Cloud Function in index.js.
 *
 * @returns {Promise<{ expired: number, checked: number }>}
 */
async function expireLinksHandler() {
  console.log('[expireLinks] Starting daily link expiration check');

  const today = todayInPropertyTz();
  console.log(`[expireLinks] Today in ${PROPERTY_TZ}: ${today}`);

  // 1. Fetch all active bookings.
  const activeSnap = await db
    .collection('bookings')
    .where('status', '==', 'active')
    .get();

  const totalActive = activeSnap.size;
  console.log(`[expireLinks] Found ${totalActive} active booking(s)`);

  if (totalActive === 0) {
    return { expired: 0, checked: 0 };
  }

  let expiredCount = 0;
  const batch = db.batch();
  const expiredBookings = [];

  for (const doc of activeSnap.docs) {
    const booking = doc.data();
    const { code, guestName, checkOutDate } = booking;

    // Guard: skip bookings with no checkout date.
    if (!checkOutDate) {
      console.warn(`[expireLinks] Booking "${code}" (${guestName}) has no checkOutDate — skipping`);
      continue;
    }

    const checkoutStr = normalizeCheckoutDate(checkOutDate);
    if (!checkoutStr) {
      console.warn(
        `[expireLinks] Booking "${code}" (${guestName}) has unparseable checkOutDate: ${checkOutDate} — skipping`
      );
      continue;
    }

    // A booking is expired if checkout date is strictly before today.
    // Guests get the full checkout day before the link expires.
    if (checkoutStr < today) {
      console.log(
        `[expireLinks] EXPIRING booking "${code}" | guest: ${guestName} | checkout: ${checkoutStr} | today: ${today}`
      );
      batch.update(doc.ref, {
        status: 'completed',
        linkExpired: true,
      });
      expiredCount++;
      expiredBookings.push({ code, guestName, checkOutDate: checkoutStr });
    } else {
      console.log(
        `[expireLinks] Booking "${code}" (${guestName}) is still active — checkout: ${checkoutStr}`
      );
    }
  }

  // 2. Commit all updates in a single batch write.
  if (expiredCount > 0) {
    await batch.commit();
    console.log(`[expireLinks] Batch committed — ${expiredCount} booking(s) expired:`);
    for (const b of expiredBookings) {
      console.log(`  - ${b.code} | ${b.guestName} | checkout: ${b.checkOutDate}`);
    }
  } else {
    console.log('[expireLinks] No bookings needed expiring today');
  }

  const summary = { expired: expiredCount, checked: totalActive };
  console.log('[expireLinks] Summary:', summary);
  return summary;
}

module.exports = { expireLinksHandler };
