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
 * Precedence:
 *   1. bookingCode (matched booking)
 *   2. 'email:' + lowercased email
 *   3. 'name:' + lowercased trimmed name
 *   4. 'unknown' (fully anonymous, preserved for backwards-compat)
 */
function buildThreadKey({ bookingCode, senderEmail, senderName } = {}) {
  if (bookingCode && String(bookingCode).trim()) {
    return String(bookingCode).trim();
  }
  if (senderEmail && String(senderEmail).trim()) {
    return 'email:' + String(senderEmail).trim().toLowerCase();
  }
  if (senderName && String(senderName).trim()) {
    return 'name:' + String(senderName).trim().toLowerCase();
  }
  return 'unknown';
}

/** Assumes input came from buildThreadKey — does NOT validate raw user input. */
function isUnmatchedKey(threadKey) {
  if (!threadKey) return true;
  return (
    threadKey === 'unknown' ||
    threadKey.startsWith('email:') ||
    threadKey.startsWith('name:')
  );
}

module.exports = { buildThreadKey, isUnmatchedKey };
