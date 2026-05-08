'use strict';

/**
 * Extract an Airbnb confirmation code (HMxxxxxxxx, 10 chars) from a VEVENT.
 *
 * Used by icsSync to dual-key match against legacy Lambda-created bookings
 * whose `externalId` was set to the confirmation code rather than the VEVENT
 * UID. On match, icsSync migrates the booking's externalId to the VEVENT UID
 * in place.
 *
 * Priority: description (Airbnb includes a reservation URL with the code) over
 * summary (may or may not contain it).
 */
function extractConfirmationCodeFromVevent(vevent) {
  if (!vevent) return null;

  const pattern = /\b(HM[A-Z0-9]{8})\b/;

  const description = vevent.description || '';
  const descMatch = description.match(pattern);
  if (descMatch) return descMatch[1];

  const summary = vevent.summary || '';
  const summaryMatch = summary.match(pattern);
  if (summaryMatch) return summaryMatch[1];

  return null;
}

module.exports = { extractConfirmationCodeFromVevent };
