'use strict';

/**
 * Email classification — is this Airbnb mail, and what kind?
 */

/**
 * @typedef {'reservation_confirmation' | 'guest_message' | 'payout' | 'review_request' | 'policy_update' | 'resolution_request' | 'unknown'} MessageType
 */

/**
 * Return true if the email is from an Airbnb sender. Non-Airbnb mail
 * (Gmail forward catches all kinds of marketing) is short-circuited
 * before classification so it never touches the booking-match path.
 */
function isAirbnbSender(fromAddress) {
  if (!fromAddress) return false;
  const lower = String(fromAddress).toLowerCase().trim();
  return lower.endsWith('@airbnb.com') || lower.endsWith('.airbnb.com');
}

/**
 * Classify an Airbnb email by its subject line.
 * Returns a MessageType string used to route the doc to the correct collection.
 *
 * @param {string} subject
 * @returns {MessageType}
 */
function classifyEmail(subject) {
  if (!subject) return 'unknown';

  // Gmail-forward normalization. When Julio forwards a guest reply from his
  // Gmail inbox, Gmail collapses the inner "RE:" into the outer "Fwd:" so a
  // subject like "RE: Reservation for X, Apr 30 – May 9" arrives as
  // "Fwd: Reservation for X, Apr 30 – May 9". Strip leading Fwd:/Fw:
  // prefixes (potentially nested) before pattern matching.
  const normalized = subject.replace(/^(?:\s*(?:fwd|fw):\s*)+/i, '').trim();

  // Reservation confirmations — check BEFORE guest messages
  // Modern Airbnb subjects: "Reservation confirmed - Jane arrives May 15",
  // "Pending: Reservation Request at {Listing} for {dates}",
  // "Same-day inquiry for {Listing}", "New inquiry for {Listing}".
  if (
    /reservation confirmed/i.test(normalized) ||
    /new booking confirmed/i.test(normalized) ||
    /reservation request from/i.test(normalized) ||
    /^pending:\s*reservation request/i.test(normalized) ||
    /^same-day inquiry for/i.test(normalized) ||
    /^new inquiry for/i.test(normalized) ||
    /^new reservation request/i.test(normalized)
  ) {
    return 'reservation_confirmation';
  }

  // Guest messages
  // Live conversational threads from express@airbnb.com use the subject
  // "RE: Reservation for {Listing}, {dates}" or "RE: Inquiry for {Listing}, ...".
  // Gmail-forwarded variants drop the RE:, leaving bare "Reservation for ...".
  // Older subject formats kept for back-compat.
  if (
    /^re:\s*reservation for\b/i.test(normalized) ||
    /^re:\s*inquiry for\b/i.test(normalized) ||
    /^reservation for\b/i.test(normalized) ||
    /^inquiry for\b/i.test(normalized) ||
    /new message from\b/i.test(normalized) ||
    /responded to your message/i.test(normalized) ||
    /sent you a message/i.test(normalized) ||
    /message from your (host|guest)/i.test(normalized)
  ) {
    return 'guest_message';
  }

  // Payout / earnings — modern: "We sent a payout of $X USD"
  if (
    /your payout for/i.test(normalized) ||
    /earnings summary/i.test(normalized) ||
    /payout sent/i.test(normalized) ||
    /payment sent/i.test(normalized) ||
    /we sent a payout/i.test(normalized) ||
    /payout of \$/i.test(normalized)
  ) {
    return 'payout';
  }

  // Review requests — "Write a review for X's group", "Guest left a 2-star review"
  if (
    /review your guest/i.test(normalized) ||
    /rate your (experience|stay|guest)/i.test(normalized) ||
    /left you a review/i.test(normalized) ||
    /write a review/i.test(normalized) ||
    /left a (\d+[- ]?star )?review/i.test(normalized) ||
    /a recent guest left/i.test(normalized)
  ) {
    return 'review_request';
  }

  // Policy / general Airbnb updates / admin-action emails
  if (
    /policy update/i.test(normalized) ||
    /terms of service/i.test(normalized) ||
    /important update from airbnb/i.test(normalized) ||
    /airbnb update/i.test(normalized) ||
    /^action required:/i.test(normalized) ||
    /^reminder on action required:/i.test(normalized) ||
    /^reservation reminder:/i.test(normalized) ||
    /^message sent off-schedule/i.test(normalized) ||
    /^request declined:/i.test(normalized) ||
    /co-host network/i.test(normalized)
  ) {
    return 'policy_update';
  }

  // Resolution Center / AirCover / damage protection cases.
  // Sender is resolutions@airbnb.com; subject usually carries the CLSF claim ID.
  // Examples: "Airbnb Reimbursement Request [CLSF-05873844] [HMRJNRRYF5]",
  //           "Host damage protection update [CLSF-...]",
  //           any subject containing a CLSF-#### claim identifier.
  if (
    /\bAirbnb Reimbursement Request\b/i.test(normalized) ||
    /\bHost damage protection\b/i.test(normalized) ||
    /\bAirCover\b/i.test(normalized) ||
    /\bResolution Center\b/i.test(normalized) ||
    /\bCLSF-\d+/i.test(normalized)
  ) {
    return 'resolution_request';
  }

  return 'unknown';
}

module.exports = { isAirbnbSender, classifyEmail };
