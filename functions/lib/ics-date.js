'use strict';

// ---------------------------------------------------------------------------
// ics-date.js
//
// Date helpers for ICS / VEVENT parsing. Shared between the Cloud Function
// sync loop (functions/icsSync.js) and the one-shot backfill script
// (scripts/fix-airbnb-dates.js) so both paths agree on how a VEVENT date
// maps to a YYYY-MM-DD calendar day.
//
// Property timezone is hardcoded to America/Puerto_Rico (single-location
// property, no DST). Change this constant if the property ever moves.
// ---------------------------------------------------------------------------

const PROPERTY_TZ = 'America/Puerto_Rico';

const _zonedYmdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PROPERTY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Convert a VEVENT date (node-ical Date or similar) to a YYYY-MM-DD string.
 *
 * DATE-only VEVENTs (Airbnb's format: `DTSTART;VALUE=DATE:20260415`) are
 * stored by node-ical at UTC midnight. Using UTC getters yields the exact
 * calendar day from the ICS file, independent of server TZ.
 *
 * DATE-TIME VEVENTs are resolved to the property timezone before extracting
 * YMD, because the user cares about the calendar day *at the property*,
 * not in UTC.
 *
 * @param {Date|string} dt         The VEVENT date (node-ical returns Date objects)
 * @param {object} [opts]
 * @param {boolean} [opts.dateOnly] Pass true when parsing a DATE-only VEVENT
 *                                  (i.e. event.datetype === 'date').
 *                                  Also detected via dt.dateOnly === true as a
 *                                  fallback for older node-ical versions.
 * @returns {string|null}           YYYY-MM-DD, or null for falsy/invalid input.
 */
function veventDateToYMD(dt, opts = {}) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (isNaN(d.getTime())) return null;

  if (opts.dateOnly || dt.dateOnly === true) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Intl.DateTimeFormat with 'en-CA' yields YYYY-MM-DD.
  return _zonedYmdFormatter.format(d);
}

module.exports = { veventDateToYMD, PROPERTY_TZ };
