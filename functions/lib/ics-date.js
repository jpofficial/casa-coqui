'use strict';

// ---------------------------------------------------------------------------
// ics-date.js
//
// Date helpers for ICS / VEVENT parsing. Shared between the Cloud Function
// sync loop (functions/icsSync.js) and the one-shot backfill script
// (scripts/fix-airbnb-dates.js) so both paths agree on how a VEVENT date
// maps to a YYYY-MM-DD calendar day.
// ---------------------------------------------------------------------------

/** Convert VEVENT date to YYYY-MM-DD string */
function veventDateToYMD(dt) {
  if (!dt) return null;
  // node-ical returns Date objects or { tz, val } objects
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

module.exports = { veventDateToYMD };
