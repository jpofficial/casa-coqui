'use strict';

/**
 * Field extraction from subject/body: confirmation codes, guest names
 * (subject → HTML → plaintext → sentinel), enrichment fields and
 * Resolution Center case fields.
 */

// ---------------------------------------------------------------------------
// Resolution-request field extraction
// ---------------------------------------------------------------------------

/**
 * Pull structured fields from a resolution_request email.
 * Keyed off the CLSF claim ID (Airbnb's stable identifier for the case).
 *
 * @param {{ subject?: string, bodyText?: string }} input
 * @returns {{
 *   claimId: string|null,
 *   confirmationCode: string|null,
 *   resolutionUrl: string|null,
 * }}
 */
function parseResolutionFields({ subject = '', bodyText = '' }) {
  const haystack = `${subject}\n${bodyText}`;

  // Claim ID — CLSF-NNNNNNNN (case-insensitive in source, normalize to upper)
  const claimMatch = haystack.match(/\bCLSF-(\d{4,})\b/i);
  const claimId = claimMatch ? `CLSF-${claimMatch[1]}` : null;

  // Reservation confirmation code — Airbnb HM-prefix codes (8-10 alphanumeric)
  const codeMatch = haystack.match(/\bHM[A-Z0-9]{8,10}\b/);
  const confirmationCode = codeMatch ? codeMatch[0] : null;

  // Resolution Center URL — the host_guarantee_host_summary?referenceId=CLSF-...
  // Capture without trailing punctuation. Also accept generic /mediation/ URLs.
  let resolutionUrl = null;
  const urlMatch = haystack.match(/https?:\/\/airbnb\.com\/mediation\/[^\s"'<>]+/i);
  if (urlMatch) {
    // Strip quoted-printable line continuations only ("=\r\n" / "=\n").
    // Do NOT strip bare "=" — those are real query-string separators.
    resolutionUrl = urlMatch[0].replace(/=\r?\n/g, '');
  }

  return { claimId, confirmationCode, resolutionUrl };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Airbnb confirmation codes are 10-character alphanumeric strings starting
 * with HM (host-managed) or HB.  We also accept any all-caps code that looks
 * like HMABCD1234 or HBXYZ67890.
 *
 * @param {string} text
 * @returns {string | null}
 */
function extractConfirmationCode(text) {
  if (!text) return null;
  // e.g. HMABCD1234, HBXYZ12345
  const match = text.match(/\bH[MB][A-Z0-9]{8}\b/);
  return match ? match[0] : null;
}

/**
 * Extract the guest name from common Airbnb subject patterns:
 *   "New message from Jane Doe"
 *   "Jane Doe responded to your message"
 *   "Message from your guest, Jane Doe"
 *
 * @param {string} subject
 * @returns {string | null}
 */
function extractGuestNameFromSubject(subject) {
  if (!subject) return null;

  let m;

  // "New message from Jane Doe"
  m = subject.match(/^New message from (.+?)(?:\s*[-–]|$)/i);
  if (m) return m[1].trim();

  // "Jane Doe responded to your message"
  m = subject.match(/^(.+?)\s+responded to your message/i);
  if (m) return m[1].trim();

  // "Message from your guest, Jane Doe" or "Message from your host, Jane Doe"
  m = subject.match(/message from your (?:guest|host),?\s+(.+?)(?:\s*[-–]|$)/i);
  if (m) return m[1].trim();

  // "Jane Doe sent you a message"
  m = subject.match(/^(.+?)\s+sent you a message/i);
  if (m) return m[1].trim();

  // "Reservation confirmed - Jane Doe arrives May 15"
  m = subject.match(/^Reservation confirmed\s*-\s*(.+?)\s+arrives\b/i);
  if (m) return m[1].trim();

  // "Request declined: Jane Doe declined to pay"
  m = subject.match(/^Request declined:\s+(.+?)\s+declined\b/i);
  if (m) return m[1].trim();

  // "Reservation reminder: Jane is coming soon!"
  m = subject.match(/^Reservation reminder:\s+(.+?)\s+is coming/i);
  if (m) return m[1].trim();

  return null;
}

// ---------------------------------------------------------------------------
// Guest-name extraction from email body (Fix 1, 2026-05-09)
// ---------------------------------------------------------------------------

/** Cap on HTML bytes scanned. Sized to cover the real Airbnb message email
 *  layout (the <h2>guest</h2>+Booker block sits around byte 16k in the
 *  observed Jaydon fixture) while still defending against ReDoS / spurious
 *  matches in arbitrarily long forwarded threads. */
const HTML_GUEST_NAME_SCAN_BYTES = 32768;

/** Names we should never accept as a guest name even if they appear in
 *  alt="..." + <h2>..</h2> + Booker — these are Airbnb chrome / branding /
 *  the property name itself. Case-insensitive match after trim. */
const GUEST_NAME_BLOCKLIST = new Set([
  'airbnb',
  'casa coqui',
  'casa coqui #1 next to everything',
  'app store',
  'google play',
  'tiktok',
  'instagram',
  'twitter',
  'facebook',
  'reservation',
  'listing',
]);

/** Minimal HTML-entity decoder — covers the entities Airbnb actually emits
 *  in alt/h2 text (named Latin-1 + numeric). Avoids a heavyweight dep. */
const NAMED_ENTITIES = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', ouml: 'ö', Ouml: 'Ö',
  auml: 'ä', Auml: 'Ä',
};

function decodeHtmlEntities(s) {
  if (!s) return s;
  return String(s)
    // numeric: &#039; &#x27;
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    // named
    .replace(/&([a-zA-Z]+);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m
    );
}

function normalizeForCompare(s) {
  if (s == null) return '';
  return decodeHtmlEntities(String(s).trim()).normalize('NFC');
}

function isBlockedName(name) {
  if (!name) return true;
  return GUEST_NAME_BLOCKLIST.has(String(name).trim().toLowerCase());
}

/**
 * Title-case a single human name token while preserving Unicode letters,
 * apostrophes, hyphens, and accents. Lowercases all chars then capitalises
 * the first letter of each word.
 */
function titleCaseName(name) {
  return String(name)
    .toLowerCase()
    // Capitalise the first letter after a word boundary (start, space, hyphen, apostrophe).
    .replace(/(^|[\s'’\-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Extract the guest name from an Airbnb-style email body.
 *
 * Priority:
 *   1) HTML — first <h2>NAME</h2> followed within ~500 chars by the literal
 *      "Booker" keyword, where NAME also appears as alt="NAME" in the same
 *      pre-sliced HTML window. Both the alt and the <h2> values are
 *      HTML-entity-decoded and NFC-normalized before comparison.
 *   2) Plaintext — Unicode-aware match for an indented uppercase line
 *      followed by a "Booker" line. Title-cased on the way out.
 *
 * Returns { name: null, source: null } on no match — the CALLER substitutes
 * the i18n-friendly "Unknown sender" sentinel. The `source` field tells the
 * caller which strategy hit ('html' | 'plaintext') so the caller does NOT
 * need to re-run the HTML scan just to log a `guestNameSource` field.
 *
 * @param {string|null} html
 * @param {string|null} text
 * @returns {{ name: string|null, source: 'html'|'plaintext'|null }}
 */
function extractGuestNameFromBody(html, text) {
  // ---- Strategy 1: HTML --------------------------------------------------
  if (html && typeof html === 'string') {
    const slice = html.slice(0, HTML_GUEST_NAME_SCAN_BYTES);

    // Collect alt="..." values (decoded + normalized) for confirmation.
    const altSet = new Set();
    const altRe = /alt="([^"]{1,200})"/g;
    let am;
    while ((am = altRe.exec(slice)) !== null) {
      const val = normalizeForCompare(am[1]);
      if (val) altSet.add(val);
    }

    // Walk every <h2>..</h2>; pick the first whose adjacent text contains
    // "Booker" within 500 chars AND whose value also appears as an alt.
    const h2Re = /<h2\b[^>]*>([^<]{1,200})<\/h2>/g;
    let hm;
    while ((hm = h2Re.exec(slice)) !== null) {
      const candidate = normalizeForCompare(hm[1]);
      if (!candidate) continue;
      if (isBlockedName(candidate)) continue;
      if (!altSet.has(candidate)) continue; // alt/h2 mismatch — skip

      // Booker keyword must appear within 500 chars after </h2>.
      const tailStart = hm.index + hm[0].length;
      const tail = slice.slice(tailStart, tailStart + 500);
      if (!/\bBooker\b/.test(tail)) continue;

      return { name: candidate, source: 'html' };
    }
  }

  // ---- Strategy 2: plaintext --------------------------------------------
  if (text && typeof text === 'string') {
    // Indented uppercase name line, then a Booker line.
    // \p{Lu} = Unicode uppercase letter; \p{L} = any letter.
    const m = text.match(/^[ \t]+(\p{Lu}[\p{L}\s'’\-]{0,60})\s*$\s*^[ \t]+Booker\b/mu);
    if (m) {
      const raw = m[1].trim();
      if (!isBlockedName(raw)) {
        return { name: titleCaseName(raw).normalize('NFC'), source: 'plaintext' };
      }
    }
  }

  return { name: null, source: null };
}

/**
 * Resolve the guest name across the four-tier strategy
 * (subject → HTML body → plaintext body → sentinel) and emit structured
 * warn-logs ONLY for fallback paths actually attempted and failed.
 *
 * Emission rules:
 *   - subject hit                                  → no warns
 *   - body via HTML                                → 'subject' warn only
 *   - body via plaintext, HTML attempted+missed    → 'subject' + 'html'
 *   - body via plaintext, HTML never attempted     → 'subject' only
 *   - all fail (each warn fires only if its strategy was attempted):
 *        always 'subject' + 'sentinel'; 'html' iff html present;
 *        'plaintext' iff text present.
 *
 * Pre-Improvement-4 the code emitted BOTH 'html' AND 'plaintext' warns
 * unconditionally on body-failure, even when one of those paths was never
 * tried. That produced noisy logs on text-only emails.
 *
 * @param {object} args
 * @param {string} args.subject
 * @param {string|null} args.html
 * @param {string|null} args.text
 * @param {string|null} args.sesMessageId
 * @param {string|null} args.objectKey
 * @param {string|null} args.fromDisplayName
 * @returns {{ guestName: string, source: 'subject'|'html'|'plaintext'|'sentinel' }}
 */
function resolveGuestNameWithLogging({ subject, html, text, sesMessageId, objectKey, fromDisplayName }) {
  const warn = (stage) => {
    console.warn(JSON.stringify({
      event: 'guest_name_fallback',
      stage,
      sesMessageId,
      objectKey,
      fromDisplayName,
    }));
  };

  const subjectName = extractGuestNameFromSubject(subject);
  if (subjectName) {
    return { guestName: subjectName, source: 'subject' };
  }

  // Subject failed — log it.
  warn('subject');

  // A path is "attempted" iff its input is a non-empty string. Match the
  // same gate extractGuestNameFromBody uses internally so the warn-log
  // tracks reality.
  const htmlAttempted = typeof html === 'string' && html.length > 0;
  const textAttempted = typeof text === 'string' && text.length > 0;

  const bodyResult = extractGuestNameFromBody(html, text);
  if (bodyResult.name) {
    // If we resolved via plaintext, HTML was attempted-and-missed; log it.
    if (bodyResult.source === 'plaintext' && htmlAttempted) {
      warn('html');
    }
    return { guestName: bodyResult.name, source: bodyResult.source };
  }

  // Total body failure — emit a warn for each path that was actually tried.
  if (htmlAttempted) warn('html');
  if (textAttempted) warn('plaintext');
  warn('sentinel');
  return { guestName: 'Unknown sender', source: 'sentinel' };
}

// ---------------------------------------------------------------------------
// Enrichment field extraction
// ---------------------------------------------------------------------------

/**
 * Extract fields used to enrich an existing booking. No date parsing — dates
 * come from ICS which is the authoritative source. Payout regex bounded to
 * avoid matching across unrelated dollar amounts (cleaning fee / service fee
 * / total) in Airbnb email bodies.
 */
function extractEnrichmentFields(subject, body) {
  const fields = {
    guestName: extractGuestNameFromSubject(subject),
    guestCount: null,
    payoutAmount: null,
    guestMessage: null,
  };

  const countMatch = body.match(/(\d+)\s+(?:adults?|guests?)/i);
  if (countMatch) fields.guestCount = parseInt(countMatch[1], 10);

  const payoutMatch = body.match(
    /(?:total|guest paid|you earn|payout)[^$]{0,200}\$([0-9,]+\.?\d*)/i
  );
  if (payoutMatch) {
    fields.payoutAmount = parseFloat(payoutMatch[1].replace(/,/g, ''));
  }

  const msgMatch = body.match(/"([^"]{20,})"/);
  if (msgMatch) fields.guestMessage = msgMatch[1].trim();

  return fields;
}

module.exports = {
  parseResolutionFields,
  extractConfirmationCode,
  extractGuestNameFromSubject,
  HTML_GUEST_NAME_SCAN_BYTES,
  GUEST_NAME_BLOCKLIST,
  decodeHtmlEntities,
  normalizeForCompare,
  isBlockedName,
  titleCaseName,
  extractGuestNameFromBody,
  resolveGuestNameWithLogging,
  extractEnrichmentFields,
};
