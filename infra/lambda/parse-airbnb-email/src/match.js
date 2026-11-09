'use strict';

/**
 * Booking matching — tiered lookup (confirmation code → email + active stay
 * window → name + active stay window) with deterministic tie-breaking.
 */

// ---------------------------------------------------------------------------
// Active-stay window matching helpers (Part A of thread-coherence fix)
// ---------------------------------------------------------------------------

const WINDOW_PRE_DAYS = 15;
const WINDOW_POST_DAYS = 5;

/** Lowercase + trim + collapse internal whitespace. Preserves accented chars. */
function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True iff `receivedAt` falls within (checkIn − 15d) … (checkOut + 5d, end-of-day). */
function isInActiveWindow(booking, receivedAt) {
  if (!booking.checkInDate || !booking.checkOutDate) return false;
  const checkIn = new Date(booking.checkInDate);
  const checkOut = new Date(booking.checkOutDate);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) return false;
  const earliest = new Date(checkIn.getTime() - WINDOW_PRE_DAYS * 86400000);
  // checkOut + (POST_DAYS + 1) - 1ms → covers all of the Nth post-day.
  const latest = new Date(checkOut.getTime() + (WINDOW_POST_DAYS + 1) * 86400000 - 1);
  return receivedAt >= earliest && receivedAt <= latest;
}

/** Absolute ms between receivedAt and the booking's stay-window midpoint. */
function midpointDistance(booking, receivedAt) {
  const checkIn = new Date(booking.data.checkInDate).getTime();
  const checkOut = new Date(booking.data.checkOutDate).getTime();
  const mid = (checkIn + checkOut) / 2;
  return Math.abs(receivedAt.getTime() - mid);
}

/**
 * Pick the best booking when tier 2 or tier 3 returns multiple candidates.
 * Order: active-stay → closest-midpoint → most-recently-created.
 */
function tieBreak(candidates, receivedAt) {
  if (candidates.length === 1) return candidates[0];

  // Step 1: prefer active-stay (receivedAt strictly within checkIn..checkOut)
  const active = candidates.filter((c) => {
    const checkIn = new Date(c.data.checkInDate);
    const checkOut = new Date(c.data.checkOutDate);
    return receivedAt >= checkIn && receivedAt <= checkOut;
  });

  let pool;
  if (active.length === 1) return active[0];
  pool = active.length > 1 ? active : candidates;

  // Step 2: closest stay-midpoint
  const sorted = [...pool].sort(
    (a, b) => midpointDistance(a, receivedAt) - midpointDistance(b, receivedAt)
  );

  // Step 3: createdAt-desc breaks midpoint tie
  if (
    sorted.length >= 2 &&
    midpointDistance(sorted[0], receivedAt) === midpointDistance(sorted[1], receivedAt)
  ) {
    const byCreated = [...sorted].sort((a, b) => {
      const aMs = a.data.createdAt?.toMillis?.() || 0;
      const bMs = b.data.createdAt?.toMillis?.() || 0;
      return bMs - aMs;
    });
    return byCreated[0];
  }

  return sorted[0];
}

// ---------------------------------------------------------------------------
// Booking match
// ---------------------------------------------------------------------------

/**
 * Generic equality + in-memory active-window filter.
 * @param {string} fieldName  e.g. 'guestEmail' or 'guestName'
 * @param {string} value      already normalized
 * @param {Date}   receivedAt
 * @returns {Promise<{ id, data } | null>}
 */
async function matchByActiveWindow(firestore, fieldName, value, receivedAt) {
  const snap = await firestore
    .collection('bookings')
    .where(fieldName, '==', value)
    .get();
  if (snap.empty) return null;

  const candidates = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((b) => isInActiveWindow(b.data, receivedAt));

  if (candidates.length === 0) return null;
  return tieBreak(candidates, receivedAt);
}

/**
 * Tiered booking match.
 *   Tier 1: airbnbConfirmationCode (gold standard, unchanged behavior).
 *   Tier 2: fromAddress + active stay window → bookings.guestEmail.
 *   Tier 3: normalized guestName + active stay window → bookings.guestName.
 *   Tier 4 (NOT v1): booking_members collection-group lookup.
 *
 * @returns {Promise<{ id, data, tier } | null>}
 */
async function findMatchingBooking(
  firestore,
  { confirmationCode, fromAddress, guestName, receivedAt }
) {
  // Tier 1
  if (confirmationCode) {
    const snap = await firestore
      .collection('bookings')
      .where('airbnbConfirmationCode', '==', confirmationCode)
      .limit(1)
      .get();
    if (!snap.empty) {
      return { id: snap.docs[0].id, data: snap.docs[0].data(), tier: 1 };
    }
  }

  // Tier 2: email + active window
  if (fromAddress && receivedAt) {
    const match = await matchByActiveWindow(
      firestore,
      'guestEmail',
      String(fromAddress).toLowerCase().trim(),
      receivedAt
    );
    if (match) return { ...match, tier: 2 };
  }

  // Tier 3: name + active window
  if (guestName && receivedAt) {
    const match = await matchByActiveWindow(
      firestore,
      'guestName',
      normalizeName(guestName),
      receivedAt
    );
    if (match) return { ...match, tier: 3 };
  }

  // Tier 4 (NOT v1): booking_members collection-group lookup. Add when sibling-guest case grows.

  return null;
}

module.exports = {
  WINDOW_PRE_DAYS,
  WINDOW_POST_DAYS,
  normalizeName,
  isInActiveWindow,
  midpointDistance,
  tieBreak,
  matchByActiveWindow,
  findMatchingBooking,
};
