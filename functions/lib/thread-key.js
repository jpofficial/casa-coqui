// @generated — DO NOT EDIT. Copied verbatim from lib/thread-key.js by scripts/sync-shared.js.
// Edit the source file, then run `npm run sync:shared`. `npm run check:shared` (CI) fails on drift.
/**
 * Build a stable grouping key for an airbnb_messages document.
 *
 * Used by:
 *   - Messages page grouping (app/admin/messages/page.js)
 *   - Thread link route (app/api/messages/threads/link)
 *   - Backfill scripts (scripts/migrations/backfill-thread-keys.js, backfill-welcome-messages.js)
 *   - Reply agent context load (functions/index.js — via the generated copy)
 *   The inbound Lambda uses its own v2 derivation (infra/lambda/parse-airbnb-email/src/thread.js)
 *   and no longer carries a copy of this file.
 *
 * SOURCE OF TRUTH. functions/lib/thread-key.js is a GENERATED copy (Firebase
 * deploys only functions/), written by scripts/sync-shared.js. Edit this file
 * only, then run `npm run sync:shared`; `npm run check:shared` (in `npm test`,
 * `prebuild` and CI) fails if the copy drifts.
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
 * Matched (returns false):
 *   - raw bookingCode (legacy v1)
 *   - 'booking:<id>'            v2 matched booking
 *   - 'airbnb:<hash>'           per-thread Reply-To token from Airbnb (v1)
 * Unmatched (returns true):
 *   - 'email:<addr>'            legacy v1 fallback
 *   - 'name:<safe>|y:<year>'    legacy v1 fallback
 *   - 'guest:<sha16>'           v2 composite (guestName + stayWindow/yearMonth)
 *   - 'unknown'                 fully anonymous
 *   - null / empty
 */
function isUnmatchedKey(threadKey) {
  if (!threadKey) return true;
  return (
    threadKey === 'unknown' ||
    threadKey.startsWith('email:') ||
    threadKey.startsWith('name:') ||
    threadKey.startsWith('guest:') // v2 unmatched composite key
  );
}

module.exports = { buildThreadKey, isUnmatchedKey };
