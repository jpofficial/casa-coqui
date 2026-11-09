'use strict';

/**
 * Threading — Airbnb Reply-To tokens, the v2 composite threadKey derivation
 * (booking → guest+stay → guest+month → unknown) and RFC 5322 header refs.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// RFC 5322 thread-header helpers (Option A Item 4)
// ---------------------------------------------------------------------------

/**
 * Extract the local-part of an Airbnb per-thread Reply-To token.
 * Airbnb sets Reply-To to <random>@reply.airbnb.com — the local-part is a
 * stable, opaque thread identifier that's perfectly suited as a thread key.
 *
 * Returns null for non-Airbnb Reply-To addresses (or missing/empty values).
 * Always lowercases the token before returning (defensive against future case
 * drift on Airbnb's side).
 *
 * @param {object} parsed - mailparser output (or a subset for tests)
 * @returns {string|null}
 */
function extractAirbnbReplyToToken(parsed) {
  const value = parsed && parsed.replyTo && parsed.replyTo.value;
  if (!Array.isArray(value) || value.length === 0) return null;
  const address = value[0] && value[0].address;
  if (!address || typeof address !== 'string') return null;
  const lower = address.trim().toLowerCase();
  const m = lower.match(/^([^@\s]+)@reply\.airbnb\.com$/);
  if (!m) return null;
  return m[1];
}

/**
 * Hash the Airbnb Reply-To token into a stable threadKey of the form
 * "airbnb:<32-hex>" (first 32 chars of sha256). Returns null for non-Airbnb
 * Reply-To addresses.
 *
 * NOTE: v1 of the threading fix used this as the canonical threadKey, but
 * production data showed Airbnb rotates Reply-To per email — so it does NOT
 * merge multi-message conversations. v2 (deriveAirbnbThreadKey) supersedes
 * this for threadKey use. We keep this helper exported so the
 * `replyToToken` debug field can still be populated (and so existing tests
 * continue to lock in its narrow contract).
 *
 * @param {object} parsed
 * @returns {string|null}
 */
function airbnbThreadKeyFromReplyTo(parsed) {
  const token = extractAirbnbReplyToToken(parsed);
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
  return 'airbnb:' + hash;
}

// ---------------------------------------------------------------------------
// v2 composite-key threading (2026-05-11)
//
// Airbnb rotates Reply-To per email, so v1's airbnbThreadKeyFromReplyTo
// produced different keys for each message in the same conversation. v2
// derives a threadKey from a priority chain:
//
//   1. bookingId          → "booking:<id>"             (matched booking)
//   2. guestName + stay   → "guest:<sha16>" of
//                           (name | stay-window | year)
//   3. guestName only     → "guest:<sha16>" of
//                           (name | yearMonth-from-receivedAt)
//   4. otherwise          → "unknown"
//
// This collapses multi-message threads when they share either a bookingId
// or a (guestName, stayWindow) signature.
// ---------------------------------------------------------------------------

const MONTH_TOKENS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// Canonicalize month tokens to 3-letter form so cosmetic variations
// ("Sept" vs "Sep" vs "September") collapse to the same threadKey.
const MONTH_CANONICAL = {
  jan: 'jan', january: 'jan',
  feb: 'feb', february: 'feb',
  mar: 'mar', march: 'mar',
  apr: 'apr', april: 'apr',
  may: 'may',
  jun: 'jun', june: 'jun',
  jul: 'jul', july: 'jul',
  aug: 'aug', august: 'aug',
  sep: 'sep', sept: 'sep', september: 'sep',
  oct: 'oct', october: 'oct',
  nov: 'nov', november: 'nov',
  dec: 'dec', december: 'dec',
};

/** Match a stay-window like "May 5 – 13" or "Apr 30 – May 9", with optional
 *  trailing ", 2026". Accepts both en-dash (U+2013) and ascii hyphen.
 *  Captures: 1=month1, 2=day1, 3=optional month2, 4=day2.
 *  The optional "for " preposition can sit ahead of the month — handled by
 *  the caller's anchor.
 *  Day bounds: 01-31 only — rejects "May 0 – 99" garbage. */
const DAY_RE = '(0?[1-9]|[12][0-9]|3[01])';
const STAY_WINDOW_RE = new RegExp(
  '\\b(' + Object.keys(MONTH_TOKENS).join('|') + ')' + // month1
  '\\s+' + DAY_RE +                                     // day1 (01-31)
  '\\s*[\\u2013\\-]\\s*' +                              // dash (en or ascii)
  '(?:(' + Object.keys(MONTH_TOKENS).join('|') + ')\\s+)?' + // optional month2
  DAY_RE + '\\b',                                       // day2 (01-31)
  'i'
);

/**
 * Extract a stay-window token from an Airbnb subject line, e.g.
 *   "RE: Reservation for Casa Coqui #1 Next to everything, May 5 – 13"
 *     → "may-5-13"
 *   "Inquiry for Cozy 4BR..., for Apr 30 – May 9"
 *     → "apr-30-may-9"
 *
 * Lowercase, dash-separated, no spaces. Tolerates en-dash and ascii hyphen.
 * Returns null when no date range is present.
 *
 * @param {string|null|undefined} subject
 * @returns {string|null}
 */
function extractStayWindowFromSubject(subject) {
  if (!subject || typeof subject !== 'string') return null;
  const m = subject.match(STAY_WINDOW_RE);
  if (!m) return null;

  // Canonicalize months to 3-letter form so "Sept" / "September" / "Sep"
  // all produce the same stay-window token.
  const month1 = MONTH_CANONICAL[m[1].toLowerCase()];
  const day1 = m[2];
  const month2 = m[3] ? MONTH_CANONICAL[m[3].toLowerCase()] : null;
  const day2 = m[4];

  const parts = month2
    ? [month1, day1, month2, day2]
    : [month1, day1, day2];

  return parts.join('-');
}

/** Match an explicit 4-digit year in the subject (e.g. ", 2026"). */
const SUBJECT_YEAR_RE = /,\s*(\d{4})\b/;

/**
 * Extract the stay year from a subject.
 *   - If subject contains an explicit 4-digit year, use it.
 *   - Otherwise infer from receivedAt year.
 *   - Edge case (December receivedAt + January stay-month) → assume next year.
 *   - Edge case (January receivedAt + December stay-month) → assume previous year.
 *
 * @param {string|null|undefined} subject
 * @param {Date|string|number} receivedAt
 * @returns {string} 4-digit year
 */
function extractStayYearFromSubject(subject, receivedAt) {
  if (subject && typeof subject === 'string') {
    const ym = subject.match(SUBJECT_YEAR_RE);
    if (ym) return ym[1];
  }

  const dt = receivedAt instanceof Date
    ? receivedAt
    : (receivedAt ? new Date(receivedAt) : new Date());
  const receivedYear = dt.getUTCFullYear();
  const receivedMonth = dt.getUTCMonth() + 1; // 1..12

  if (subject && typeof subject === 'string') {
    const mm = subject.match(STAY_WINDOW_RE);
    if (mm) {
      const stayMonth = MONTH_TOKENS[mm[1].toLowerCase()];
      // December received + January stay → next year
      if (receivedMonth === 12 && stayMonth === 1) {
        return String(receivedYear + 1);
      }
      // January received + December stay → previous year
      if (receivedMonth === 1 && stayMonth === 12) {
        return String(receivedYear - 1);
      }
    }
  }

  return String(receivedYear);
}

/**
 * Derive a v2 composite threadKey for an Airbnb message.
 *
 * Priority (the `threadKeyPath` tag identifies which priority tier won;
 * emitted alongside the threadKey for observability):
 *   1. matched booking            → "booking:<id>"            path='booking'
 *   2. guestName + stay window    → "guest:<sha16>" of
 *                                   (name|window|year)        path='guest-stay'
 *   3. guestName w/o stay window  → "guest:<sha16>" of
 *                                   (name|yearMonth)          path='guest-month'
 *   4. fully anonymous            → "unknown"                 path='unknown'
 *
 * @param {{
 *   bookingId?: string|null,
 *   guestName?: string|null,
 *   subject?: string|null,
 *   receivedAt?: Date|string|number|null,
 * }} input
 * @returns {{ threadKey: string, threadKeyPath: 'booking'|'guest-stay'|'guest-month'|'unknown' }}
 */
function deriveAirbnbThreadKey({ bookingId, guestName, subject, receivedAt } = {}) {
  if (bookingId && String(bookingId).trim()) {
    return {
      threadKey: `booking:${String(bookingId).trim()}`,
      threadKeyPath: 'booking',
    };
  }

  if (
    guestName &&
    typeof guestName === 'string' &&
    guestName.trim() &&
    guestName !== 'Unknown sender'
  ) {
    const lowerName = guestName.toLowerCase().trim();
    const stayWindow = extractStayWindowFromSubject(subject);
    if (stayWindow) {
      const year = extractStayYearFromSubject(subject, receivedAt);
      const composite = [lowerName, stayWindow, year].join('|');
      const hash = crypto.createHash('sha256').update(composite).digest('hex').slice(0, 16);
      return { threadKey: `guest:${hash}`, threadKeyPath: 'guest-stay' };
    }
    // No stay window — fall back to year-month from receivedAt.
    const dt = receivedAt instanceof Date
      ? receivedAt
      : (receivedAt ? new Date(receivedAt) : new Date());
    const yearMonth = dt.toISOString().slice(0, 7); // "YYYY-MM"
    const composite = [lowerName, yearMonth].join('|');
    const hash = crypto.createHash('sha256').update(composite).digest('hex').slice(0, 16);
    return { threadKey: `guest:${hash}`, threadKeyPath: 'guest-month' };
  }

  return { threadKey: 'unknown', threadKeyPath: 'unknown' };
}

/**
 * Pull In-Reply-To and References from a mailparser parsed object.
 * Normalizes references to always be an array (mailparser may return
 * a single string OR an array depending on header format).
 *
 * @param {object} parsed - mailparser output (or a subset for tests)
 * @returns {{ inReplyTo: string|null, references: string[] }}
 */
function extractHeaderRefs(parsed) {
  // RFC 5322 spec: In-Reply-To is a single Message-ID. But mailparser has
  // historically been inconsistent — some versions return an array. Defensive:
  // if it's an array, take the last element (the most recent parent per the
  // RFC's "the parent" semantic). String() coercion on an array would produce
  // a comma-joined malformed value, so this guard matters.
  let inReplyTo = null;
  if (Array.isArray(parsed.inReplyTo)) {
    const last = parsed.inReplyTo
      .filter((v) => v && String(v).trim())
      .map((v) => String(v).trim())
      .pop();
    inReplyTo = last || null;
  } else if (parsed.inReplyTo && String(parsed.inReplyTo).trim()) {
    inReplyTo = String(parsed.inReplyTo).trim();
  }

  let references = [];
  if (Array.isArray(parsed.references)) {
    references = parsed.references.filter((r) => r && String(r).trim()).map((r) => String(r).trim());
  } else if (parsed.references && String(parsed.references).trim()) {
    // Single string — may contain whitespace-separated message-ids per RFC 5322.
    references = String(parsed.references)
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return { inReplyTo, references };
}

/**
 * Reverse lookup: given an RFC Message-ID, find the Firestore doc id of an
 * airbnb_messages doc whose messageId field matches. Used to resolve
 * inReplyTo into a direct doc reference.
 *
 * Returns null if inReplyTo is null/empty or no matching doc exists.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string|null} inReplyTo
 * @returns {Promise<string|null>}
 */
async function findParentMessageDocId(firestore, inReplyTo) {
  if (!inReplyTo) return null;
  const snap = await firestore
    .collection('airbnb_messages')
    .where('messageId', '==', inReplyTo)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

module.exports = {
  extractAirbnbReplyToToken,
  airbnbThreadKeyFromReplyTo,
  extractStayWindowFromSubject,
  extractStayYearFromSubject,
  deriveAirbnbThreadKey,
  extractHeaderRefs,
  findParentMessageDocId,
};
