/**
 * Build a stable grouping key for an airbnb_messages document.
 *
 * Used by:
 *   - Lambda on inbound write (infra/lambda/parse-airbnb-email)
 *   - Mark-as-Sent write (app/api/bookings/[id]/welcome)
 *   - Backfill script (scripts/backfill-thread-keys.js)
 *   - Messages page grouping (app/admin/messages/page.js)
 *   - Reply agent context load (functions/index.js)
 *
 * IMPORTANT: This file is one of THREE copies that must stay in sync:
 *   - lib/thread-key.js                                 (repo root, UI + scripts)
 *   - functions/lib/thread-key.js                       (Cloud Functions deploy)
 *   - infra/lambda/parse-airbnb-email/thread-key.js     (THIS FILE — Lambda deploy)
 * If you change one, change all three.
 *
 * Precedence:
 *   1. bookingCode (matched booking)
 *   2. 'email:' + lowercased email — UNLESS address is an Airbnb forwarder
 *      (@airbnb.com), which collapses unrelated conversations
 *   3. 'name:' + Unicode-safe name + '|y:' + UTC year of receivedAt
 *   4. 'unknown' (fully anonymous, preserved for backwards-compat)
 *
 * @param {{
 *   bookingCode?: string|null,
 *   senderEmail?: string|null,
 *   senderName?: string|null,
 *   receivedAt?: Date|string|number|null,
 * }} input
 */
function buildThreadKey({ bookingCode, senderEmail, senderName, receivedAt } = {}) {
  if (bookingCode && String(bookingCode).trim()) {
    return String(bookingCode).trim();
  }

  const email = senderEmail && String(senderEmail).trim().toLowerCase();
  const isAirbnbForwarder = email && /@airbnb\.com$/.test(email);

  if (email && !isAirbnbForwarder) {
    return 'email:' + email;
  }

  if (senderName && String(senderName).trim()) {
    // Unicode-letter-aware: preserves "josé" / "müller" intact instead of stripping.
    const safeName = String(senderName).trim().toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '');
    if (safeName) {
      const dt = receivedAt instanceof Date
        ? receivedAt
        : (receivedAt ? new Date(receivedAt) : new Date());
      const year = dt.getUTCFullYear();
      return `name:${safeName}|y:${year}`;
    }
  }

  return 'unknown';
}

/**
 * Assumes input came from buildThreadKey or the Lambda's Reply-To path —
 * does NOT validate raw user input.
 *
 * Matched (returns false): bookingCode (raw), 'airbnb:<hash>' (per-thread
 * Reply-To token from Airbnb — well-keyed even without a booking match).
 * Unmatched (returns true): 'email:', 'name:', 'unknown', null/empty.
 */
function isUnmatchedKey(threadKey) {
  if (!threadKey) return true;
  return (
    threadKey === 'unknown' ||
    threadKey.startsWith('email:') ||
    threadKey.startsWith('name:')
  );
}

module.exports = { buildThreadKey, isUnmatchedKey };
