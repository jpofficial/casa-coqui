'use strict';

/**
 * parse-airbnb-email — Lambda handler (Phase 4 — full implementation)
 *
 * Triggered by SES ReceiptRule after a raw email is saved to S3.
 * Reads the raw MIME email, classifies it, matches it to a Firestore booking,
 * and writes the result to `airbnb_messages` (or `airbnb_messages_quarantine`
 * if the message cannot be matched or is not a guest message).
 *
 * Event shape (SES → Lambda, invocation type: Event):
 *   event.Records[].ses.mail.messageId
 *   event.Records[].ses.receipt.action.bucketName
 *   event.Records[].ses.receipt.action.objectKey
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const { simpleParser } = require('mailparser');
const admin = require('firebase-admin');

// ---------------------------------------------------------------------------
// AWS clients (module-level — reused across warm invocations)
// ---------------------------------------------------------------------------

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// ---------------------------------------------------------------------------
// Firebase Admin — lazy initialisation, module-level cache
// ---------------------------------------------------------------------------

/** @type {import('firebase-admin').app.App | null} */
let firebaseApp = null;

/** @type {import('firebase-admin').firestore.Firestore | null} */
let db = null;

/**
 * Initialise (or return the cached) Firebase Admin app.
 * Service-account JSON is fetched once from Secrets Manager per container.
 */
async function getFirestore() {
  if (db) return db;

  const secretName =
    process.env.FIREBASE_SECRET_NAME || 'casa-coqui/firebase-service-account';

  const secretResponse = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );

  const serviceAccount = JSON.parse(secretResponse.SecretString);

  // Guard: only call initializeApp once per container lifetime
  if (!admin.apps.length) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    firebaseApp = admin.apps[0];
  }

  db = admin.firestore(firebaseApp);
  return db;
}

// ---------------------------------------------------------------------------
// Email classification
// ---------------------------------------------------------------------------

const crypto = require('crypto');

/**
 * Parser version stamped on every airbnb_messages / airbnb_messages_quarantine
 * doc this Lambda writes. Bump when changing extraction or thread-keying logic
 * so legacy docs are queryable and rollback is observable.
 */
const PARSER_VERSION = '2026-05-09';

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ---------------------------------------------------------------------------
// Minimal inline FCM push — mirrors lib/staff-notifications.js notifyAdminAndCohost.
// Keep in sync manually until extracted to a shared workspace package.
// Writes a staff_notifications doc per recipient + sends FCM to each of their
// fcm_tokens. Locale fallback: reads users/{uid}.locale, defaults 'en'.
// ---------------------------------------------------------------------------
async function notifyAdminAndCohost(firestore, { titleEn, titleEs, bodyEn, bodyEs, bodyParams = {}, type, data = {} }) {
  try {
    const usersSnap = await firestore
      .collection('users')
      .where('role', 'in', ['admin', 'cohost'])
      .where('status', '==', 'active')
      .get();

    if (usersSnap.empty) {
      console.warn('[lambda notifyAdminAndCohost] No active admin/cohost users found');
      return;
    }

    const interpolate = (tpl) =>
      Object.entries(bodyParams).reduce(
        (s, [k, v]) => s.replaceAll(`{${k}}`, v),
        tpl
      );

    const nowIso = new Date().toISOString();
    const messaging = admin.messaging(firebaseApp);

    await Promise.all(
      usersSnap.docs.map(async (userDoc) => {
        const uid = userDoc.id;
        const userData = userDoc.data() || {};
        const locale = userData.locale === 'es' ? 'es' : 'en';
        const pushTitle = locale === 'es' ? titleEs : titleEn;
        const pushBody = interpolate(locale === 'es' ? bodyEs : bodyEn);
        // Firestore doc stores English canonical copy.
        const docTitle = titleEn;
        const docBody = interpolate(bodyEn);

        // 1. FCM push to each of this user's tokens
        try {
          const tokenSnap = await firestore
            .collection('fcm_tokens')
            .where('staffId', '==', uid)
            .get();
          if (!tokenSnap.empty) {
            const pushData = {
              type,
              ...data,
              title: String(pushTitle),
              body: String(pushBody),
            };
            await Promise.all(
              tokenSnap.docs.map(async (tokDoc) => {
                const tkn = tokDoc.data().token;
                if (!tkn) return;
                try {
                  await messaging.send({ token: tkn, data: pushData });
                } catch (fcmErr) {
                  console.error(`[lambda notifyAdminAndCohost] FCM failed for ${uid}:`, fcmErr.message);
                }
              })
            );
          }
        } catch (tokErr) {
          console.error(`[lambda notifyAdminAndCohost] Token lookup failed for ${uid}:`, tokErr.message);
        }

        // 2. Always write in-app staff_notifications doc
        await firestore.collection('staff_notifications').add({
          recipientId: uid,
          title: docTitle,
          body: docBody,
          type,
          data,
          read: false,
          createdAt: nowIso,
        });
      })
    );
  } catch (err) {
    console.error('[lambda notifyAdminAndCohost] Error:', err.message);
  }
}

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

/** Match a stay-window like "May 5 – 13" or "Apr 30 – May 9", with optional
 *  trailing ", 2026". Accepts both en-dash (U+2013) and ascii hyphen.
 *  Captures: 1=month1, 2=day1, 3=optional month2, 4=day2.
 *  The optional "for " preposition can sit ahead of the month — handled by
 *  the caller's anchor. */
const STAY_WINDOW_RE = new RegExp(
  '\\b(' + Object.keys(MONTH_TOKENS).join('|') + ')' + // month1
  '\\s+(\\d{1,2})' +                                     // day1
  '\\s*[\\u2013\\-]\\s*' +                                // dash (en or ascii)
  '(?:(' + Object.keys(MONTH_TOKENS).join('|') + ')\\s+)?' + // optional month2
  '(\\d{1,2})\\b',                                       // day2
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

  const month1 = m[1].toLowerCase();
  const day1 = m[2];
  const month2 = m[3] ? m[3].toLowerCase() : null;
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
 * Priority:
 *   1. matched booking            → "booking:<id>"
 *   2. guestName + stay window    → "guest:<sha16>" of (name|window|year)
 *   3. guestName w/o stay window  → "guest:<sha16>" of (name|yearMonth)
 *   4. fully anonymous            → "unknown"
 *
 * @param {{
 *   bookingId?: string|null,
 *   guestName?: string|null,
 *   subject?: string|null,
 *   receivedAt?: Date|string|number|null,
 * }} input
 * @returns {string}
 */
function deriveAirbnbThreadKey({ bookingId, guestName, subject, receivedAt } = {}) {
  if (bookingId && String(bookingId).trim()) {
    return `booking:${String(bookingId).trim()}`;
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
      return `guest:${hash}`;
    }
    // No stay window — fall back to year-month from receivedAt.
    const dt = receivedAt instanceof Date
      ? receivedAt
      : (receivedAt ? new Date(receivedAt) : new Date());
    const yearMonth = dt.toISOString().slice(0, 7); // "YYYY-MM"
    const composite = [lowerName, yearMonth].join('|');
    const hash = crypto.createHash('sha256').update(composite).digest('hex').slice(0, 16);
    return `guest:${hash}`;
  }

  return 'unknown';
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

// ---------------------------------------------------------------------------
// Idempotency check
// ---------------------------------------------------------------------------

/**
 * Return true if a doc already exists in the given collection that matches
 * either the rawEmailS3Key or the messageId header.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string} collection
 * @param {string} rawEmailS3Key
 * @param {string | null} messageId
 * @returns {Promise<boolean>}
 */
async function isDuplicate(firestore, collection, rawEmailS3Key, messageId) {
  const colRef = firestore.collection(collection);

  // Check by S3 key (most reliable — one object = one email)
  const byKey = await colRef
    .where('rawEmailS3Key', '==', rawEmailS3Key)
    .limit(1)
    .get();
  if (!byKey.empty) return true;

  // Check by Message-ID header
  if (messageId) {
    const byMsgId = await colRef
      .where('messageId', '==', messageId)
      .limit(1)
      .get();
    if (!byMsgId.empty) return true;
  }

  return false;
}

/**
 * Claim a processing lock for this email. Returns { claimed: bool, lockRef }.
 *
 * Fast path: .create() is the Firestore primitive that fails with
 * ALREADY_EXISTS if the doc exists — gives us CAS on first claim.
 *
 * Slow path (lock exists): runTransaction gives CAS on the read-then-
 * conditional-write reclaim of stale locks. Firestore auto-retries the
 * transaction on contention; concurrent reclaimers serialize.
 */

// Firestore admin SDK surfaces Firestore errors with numeric gRPC status codes.
// 6 = ALREADY_EXISTS. If the SDK ever switches to string codes like
// 'already-exists', checking both keeps claimTombstone correct.
const FIRESTORE_ALREADY_EXISTS_CODES = [6, 'already-exists'];

function isAlreadyExistsError(err) {
  return FIRESTORE_ALREADY_EXISTS_CODES.includes(err.code);
}

async function claimTombstone(firestore, objectKey, rfcMessageId) {
  const lockId = sha256(objectKey).slice(0, 32);
  const lockRef = firestore.collection('airbnb_processing_locks').doc(lockId);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    await lockRef.create({
      rawEmailS3Key: objectKey,
      messageId: rfcMessageId || null,
      status: 'processing',
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      claimedBy: process.env.AWS_LAMBDA_REQUEST_ID || 'unknown',
      expiresAt,
    });
    return { claimed: true, lockRef };
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
  }

  return await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = snap.data() || {};
    const claimedAtMs = data.claimedAt?.toMillis?.() || 0;
    const staleThresholdMs = Date.now() - 5 * 60 * 1000;
    const isStale =
      (data.status === 'processing' && claimedAtMs < staleThresholdMs) ||
      data.status === 'reclaimable';

    if (!isStale) return { claimed: false, lockRef };

    tx.update(lockRef, {
      status: 'processing',
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      claimedBy: process.env.AWS_LAMBDA_REQUEST_ID || 'unknown',
      reclaimedFrom: data.claimedBy || 'unknown',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return { claimed: true, lockRef };
  });
}

async function markTombstoneCompleted(lockRef) {
  await lockRef.update({
    status: 'completed',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// S3 helper: stream → Buffer
// ---------------------------------------------------------------------------

/**
 * Read an S3 object body stream into a Buffer.
 *
 * @param {import('@aws-sdk/client-s3').GetObjectCommandOutput} s3Response
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(s3Response) {
  const chunks = [];
  for await (const chunk of s3Response.Body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * @param {import('aws-lambda').SESEvent} event
 */
exports.handler = async (event) => {
  console.log('parse-airbnb-email invoked', JSON.stringify({ recordCount: event.Records?.length }));

  let processedCount = 0;
  let quarantinedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const record of event.Records ?? []) {
    const mail = record.ses?.mail ?? {};
    const action = record.ses?.receipt?.action ?? {};

    const sesMessageId = mail.messageId ?? 'unknown';
    const bucketName = action.bucketName ?? process.env.EMAIL_BUCKET_NAME;
    // When Lambda is invoked async (EVENT), SES doesn't include the S3 action
    // details. Derive the object key from the prefix + SES message ID, which
    // is how the S3 action stores the raw email.
    const objectKey = action.objectKey ?? (sesMessageId !== 'unknown' ? `airbnb/${sesMessageId}` : null);

    console.log('Processing record', { sesMessageId, bucketName, objectKey });

    if (!bucketName || !objectKey) {
      console.warn('Missing bucketName or objectKey — skipping record', { sesMessageId });
      skippedCount++;
      continue;
    }

    try {
      // ------------------------------------------------------------------
      // 1. Read raw email from S3
      // ------------------------------------------------------------------
      const s3Response = await s3.send(
        new GetObjectCommand({ Bucket: bucketName, Key: objectKey })
      );
      const rawBuffer = await streamToBuffer(s3Response);

      console.log('Email retrieved from S3', {
        sesMessageId,
        objectKey,
        sizeBytes: rawBuffer.length,
      });

      // ------------------------------------------------------------------
      // 2. Parse the MIME email
      // ------------------------------------------------------------------
      const parsed = await simpleParser(rawBuffer);

      const subject = parsed.subject || '';
      const fromName = parsed.from?.value?.[0]?.name || null;
      const fromAddress = parsed.from?.value?.[0]?.address || null;
      const bodyText = parsed.text || parsed.html || '';
      const receivedAt = parsed.date ? new Date(parsed.date) : new Date();
      // The RFC-2822 Message-ID header (different from SES messageId)
      const rfcMessageId = parsed.messageId || null;
      const { inReplyTo, references } = extractHeaderRefs(parsed);
      // Per-thread Reply-To token from Airbnb (e.g. <token>@reply.airbnb.com).
      // v2: kept as a debug field on the Firestore doc only — no longer
      // load-bearing for threading because Airbnb rotates Reply-To per email.
      // See deriveAirbnbThreadKey for the canonical v2 threadKey derivation.
      const replyToToken = extractAirbnbReplyToToken(parsed);

      console.log('Email parsed', {
        subject,
        fromAddress,
        fromName,
        receivedAt: receivedAt.toISOString(),
        rfcMessageId,
        bodyLength: bodyText.length,
      });

      // ------------------------------------------------------------------
      // 3. Get Firestore client (hoisted — needed for dedupe + claim below)
      // ------------------------------------------------------------------
      const firestore = await getFirestore();

      // ------------------------------------------------------------------
      // 3b. Dedupe across all three terminal collections before any side
      //     effect. SES → Lambda is at-least-once; a duplicate terminal
      //     record means we already processed this email successfully.
      //
      //     Hoisted above classify/extract so the at-most-once guarantee
      //     holds even if a classifier/extractor is ever changed to do I/O.
      // ------------------------------------------------------------------
      const [msgDup, quarDup] = await Promise.all([
        isDuplicate(firestore, 'airbnb_messages', objectKey, rfcMessageId),
        isDuplicate(firestore, 'airbnb_messages_quarantine', objectKey, rfcMessageId),
      ]);
      if (msgDup || quarDup) {
        console.log('duplicate — terminal record exists, skipping', {
          sesMessageId, objectKey,
        });
        skippedCount++;
        continue;
      }

      // ------------------------------------------------------------------
      // 3c. Authoritative claim — .create() fails if lock doc exists (CAS).
      //     Crashed invocations leave locks at 'processing'; lockSweeper
      //     (Commit 4) flips them to 'reclaimable' after 5 min.
      // ------------------------------------------------------------------
      const claim = await claimTombstone(firestore, objectKey, rfcMessageId);
      if (!claim.claimed) {
        console.log('duplicate — lock held by another invocation', {
          sesMessageId, objectKey,
        });
        skippedCount++;
        continue;
      }

      // ------------------------------------------------------------------
      // 3d. Short-circuit non-Airbnb senders. The Gmail forward address is
      //     also catching marketing mail (Reddit, Lyft, MoveOn, etc.). These
      //     never need to enter the booking-match path — quarantine and move on.
      // ------------------------------------------------------------------
      if (!isAirbnbSender(fromAddress)) {
        await firestore.collection('airbnb_messages_quarantine').add({
          messageType: 'non_airbnb',
          subject,
          fromName,
          fromAddress,
          body: bodyText.slice(0, 2000),
          receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
          rawEmailS3Key: objectKey,
          messageId: rfcMessageId,
          sesMessageId,
          parserVersion: PARSER_VERSION,
          quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'non_airbnb_sender',
        });
        console.log('Non-Airbnb sender — quarantined', { fromAddress });
        quarantinedCount++;
        await markTombstoneCompleted(claim.lockRef);
        continue;
      }

      // Resolve inReplyTo to a parent Firestore doc id (best-effort; null if not found).
      const replyToId = await findParentMessageDocId(firestore, inReplyTo);

      // ------------------------------------------------------------------
      // 4. Classify message type
      // ------------------------------------------------------------------
      const messageType = classifyEmail(subject);

      console.log('Email classified', { messageType, subject });

      // ------------------------------------------------------------------
      // 5. Extract confirmation code + guest name
      //
      //    Guest name resolution (Fix 1, 2026-05-09):
      //      1) subject regex   (e.g. "New message from Jane Doe")
      //      2) HTML body       (alt="Jane" + <h2>Jane</h2> + Booker anchor)
      //      3) plaintext body  (indented uppercase line + Booker line)
      //      4) sentinel        ('Unknown sender' — never `fromName`, which
      //                          is always literally "Airbnb" for Airbnb mail)
      //
      //    `fromName` is preserved on the doc as `fromDisplayName` for
      //    forensics but no longer leaks into guestName.
      // ------------------------------------------------------------------
      const confirmationCode =
        extractConfirmationCode(subject) || extractConfirmationCode(bodyText);

      const fromDisplayName = fromName;
      const { guestName, source: guestNameSource } = resolveGuestNameWithLogging({
        subject,
        html: parsed.html,
        text: parsed.text,
        sesMessageId,
        objectKey,
        fromDisplayName,
      });

      console.log('Extracted fields', {
        confirmationCode,
        guestName,
        guestNameSource,
        fromDisplayName,
      });

      // ------------------------------------------------------------------
      // 6. Route reservation confirmations → enrich or quarantine
      //    Lambda NEVER creates bookings. ICS is the sole booking creator.
      //    (See docs/superpowers/specs/2026-04-18-parse-airbnb-email-correctness-design.md)
      // ------------------------------------------------------------------
      if (messageType === 'reservation_confirmation') {
        const matched = await findMatchingBooking(firestore, {
          confirmationCode,
          fromAddress,
          guestName,
          receivedAt,
        });
        const fields = extractEnrichmentFields(subject, bodyText);

        if (!matched) {
          await firestore.collection('airbnb_messages_quarantine').add({
            messageType: 'reservation_confirmation',
            reason: 'unmatched_awaiting_ics',
            status: 'pending',
            subject,
            body: bodyText.slice(0, 4000),
            receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
            rawEmailS3Key: objectKey,
            messageId: rfcMessageId,
            sesMessageId,
            airbnbConfirmationCode: confirmationCode || null,
            enrichmentFields: fields,
            parserVersion: PARSER_VERSION,
            quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log('reservation confirmation unmatched — quarantined', {
            airbnbConfirmationCode: confirmationCode,
          });
          quarantinedCount++;
          await markTombstoneCompleted(claim.lockRef);
          continue;
        }

        // Enrich — never overwrite existing non-null fields.
        const existing = matched.data;
        const genericNames = ['airbnb guest', 'guest', ''];
        const existingNameGeneric = genericNames.includes(
          (existing.guestName || '').toLowerCase().trim()
        );

        // Capture before the update: used to gate first-enrichment push.
        const firstEnrichment = !existing.lastEnrichedFromEmailAt;

        const updates = {};
        if (fields.guestName && existingNameGeneric) updates.guestName = fields.guestName;
        if (fields.guestCount && !existing.guestCount) updates.guestCount = fields.guestCount;
        if (fields.payoutAmount && !existing.payoutAmount) updates.payoutAmount = fields.payoutAmount;
        if (fields.guestMessage && !existing.guestMessage) updates.guestMessage = fields.guestMessage;

        if (Object.keys(updates).length > 0) {
          updates.lastEnrichedFromEmailAt = new Date().toISOString();
          await firestore.collection('bookings').doc(matched.id).update(updates);
          console.log('booking enriched from email', {
            bookingId: matched.id,
            fieldsUpdated: Object.keys(updates),
          });

          // Near-real-time staff push on first enrichment only.
          // Idempotent — gated on lastEnrichedFromEmailAt (unset before this write).
          if (firstEnrichment) {
            const guestName = updates.guestName || existing.guestName || 'Guest';
            await notifyAdminAndCohost(firestore, {
              titleEn: 'Airbnb email received',
              titleEs: 'Email de Airbnb recibido',
              bodyEn: 'Booking details enriched from email for {guestName}',
              bodyEs: 'Detalles de reserva enriquecidos por email para {guestName}',
              bodyParams: { guestName },
              type: 'booking_enriched',
              data: { bookingId: matched.id, targetPath: '/admin/bookings' },
            });
          }
        }

        processedCount++;
        await markTombstoneCompleted(claim.lockRef);
        continue;
      }

      // ------------------------------------------------------------------
      // 6b. Route resolution requests (AirCover / Resolution Center cases) to
      //     dedicated airbnb_resolutions collection, keyed by claimId so
      //     follow-up emails on the same case upsert into one doc.
      // ------------------------------------------------------------------
      if (messageType === 'resolution_request') {
        const fields = parseResolutionFields({ subject, bodyText });
        const claimId = fields.claimId;

        if (!claimId) {
          // Couldn't extract a claim ID — fall through to quarantine for triage
          console.warn('resolution_request without parseable claimId — quarantining', {
            subject,
            objectKey,
          });
        } else {
          const resCode = fields.confirmationCode || confirmationCode || null;
          const docRef = firestore.collection('airbnb_resolutions').doc(claimId);
          const existing = await docRef.get();
          const isFirstArrival = !existing.exists;

          // Best-effort booking match — same lookup as guest messages.
          let bookingId = null;
          if (resCode) {
            const matched = await findMatchingBooking(firestore, {
              confirmationCode: resCode,
              fromAddress,
              guestName,
              receivedAt,
            });
            if (matched) bookingId = matched.id;
          }

          const nowTs = admin.firestore.FieldValue.serverTimestamp();
          const payload = {
            claimId,
            confirmationCode: resCode,
            bookingId,
            subject,
            fromName,
            fromAddress,
            receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
            resolutionUrl: fields.resolutionUrl,
            bodyText: bodyText.slice(0, 16000), // cap; chatbot will get the full text from S3 later
            rawEmailS3Key: objectKey,
            messageId: rfcMessageId,
            sesMessageId,
            parserVersion: PARSER_VERSION,
            updatedAt: nowTs,
          };

          if (isFirstArrival) {
            payload.status = 'open';
            payload.createdAt = nowTs;
            payload.adminNotifiedAt = null;
          }

          await docRef.set(payload, { merge: true });
          console.log('airbnb_resolutions upserted', { claimId, isFirstArrival, objectKey });

          // Notify admin/cohost only on first arrival of a claim.
          // Subsequent emails for the same claim update the doc silently.
          if (isFirstArrival) {
            await notifyAdminAndCohost(firestore, {
              titleEn: 'Airbnb resolution case opened',
              titleEs: 'Caso de resolución de Airbnb abierto',
              bodyEn: 'Claim {claimId} from resolutions@airbnb.com{bookingPart}',
              bodyEs: 'Reclamo {claimId} de resolutions@airbnb.com{bookingPart}',
              bodyParams: {
                claimId,
                bookingPart: resCode ? ` — booking ${resCode}` : '',
              },
              type: 'resolution_request',
              data: {
                claimId,
                confirmationCode: resCode || '',
                bookingId: bookingId || '',
                resolutionUrl: fields.resolutionUrl || '',
                targetPath: '/admin/resolutions',
              },
            });
            await docRef.update({ adminNotifiedAt: nowTs });
          }

          processedCount++;
          await markTombstoneCompleted(claim.lockRef);
          continue;
        }
      }

      // ------------------------------------------------------------------
      // 6c. Route other non-guest-message emails straight to quarantine
      // ------------------------------------------------------------------
      if (messageType !== 'guest_message') {
        console.log('Non-guest message — routing to quarantine', { messageType });

        await firestore.collection('airbnb_messages_quarantine').add({
          messageType,
          subject,
          fromName,
          fromAddress,
          body: bodyText.slice(0, 4000), // cap stored body
          receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
          rawEmailS3Key: objectKey,
          messageId: rfcMessageId,
          sesMessageId,
          airbnbConfirmationCode: confirmationCode,
          parserVersion: PARSER_VERSION,
          quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: `messageType:${messageType}`,
        });

        console.log('Written to airbnb_messages_quarantine', { messageType, objectKey });
        quarantinedCount++;
        await markTombstoneCompleted(claim.lockRef);
        continue;
      }

      // ------------------------------------------------------------------
      // 7. Match to a booking
      // ------------------------------------------------------------------
      const booking = await findMatchingBooking(firestore, {
        confirmationCode,
        fromAddress,
        guestName,
        receivedAt,
      });

      if (!booking) {
        console.warn('No matching booking found — writing as unmatched', {
          confirmationCode,
          guestName,
        });

        // v2 composite threadKey — bookingId is null on the unmatched path, so
        // the derivation falls through to the guestName+stayWindow path
        // (or 'unknown' when no name was extracted).
        const senderNameForKey = guestNameSource === 'sentinel' ? null : guestName;
        const unmatchedThreadKey = deriveAirbnbThreadKey({
          bookingId: null,
          guestName: senderNameForKey,
          subject,
          receivedAt,
        });

        // Write to airbnb_messages with null bookingId so it appears in admin UI
        await firestore.collection('airbnb_messages').add({
          bookingId: null,
          guestName: guestName || null,
          direction: 'inbound',
          body: bodyText.slice(0, 8000),
          receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
          rawEmailS3Key: objectKey,
          messageId: rfcMessageId,
          inReplyTo,
          references,
          replyToId,
          sesMessageId,
          airbnbConfirmationCode: confirmationCode || null,
          subject,
          fromName,
          fromDisplayName,
          fromAddress,
          read: false,
          draftReply: null,
          draftStatus: 'pending',
          draftedAt: null,
          sentAt: null,
          editedReply: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          threadKey: unmatchedThreadKey,
          replyToToken,
          parserVersion: PARSER_VERSION,
          source: 'inbound',
        });

        console.log('Written unmatched guest_message to airbnb_messages');

        // Also archive to quarantine for record-keeping
        await firestore.collection('airbnb_messages_quarantine').add({
          messageType: 'guest_message',
          subject,
          fromName,
          fromDisplayName,
          fromAddress,
          body: bodyText.slice(0, 4000),
          receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
          rawEmailS3Key: objectKey,
          messageId: rfcMessageId,
          inReplyTo,
          references,
          replyToId,
          sesMessageId,
          airbnbConfirmationCode: confirmationCode,
          guestName,
          threadKey: unmatchedThreadKey,
          replyToToken,
          parserVersion: PARSER_VERSION,
          quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'no_matching_booking',
        });

        processedCount++;
        await markTombstoneCompleted(claim.lockRef);
        continue;
      }

      // ------------------------------------------------------------------
      // 9. Write to airbnb_messages
      // ------------------------------------------------------------------
      const docData = {
        bookingId: booking.id,
        guestName: guestName || booking.data.guestName || null,
        direction: 'inbound',
        body: bodyText.slice(0, 8000), // generous cap for real messages
        receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
        rawEmailS3Key: objectKey,
        messageId: rfcMessageId,
        inReplyTo,
        references,
        replyToId,
        sesMessageId,
        airbnbConfirmationCode:
          confirmationCode || booking.data.airbnbConfirmationCode || null,
        subject,
        fromAddress,
        fromDisplayName,
        // Reply workflow fields — all null on ingest
        draftReply: null,
        draftStatus: 'pending',
        draftedAt: null,
        sentAt: null,
        editedReply: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        threadKey: deriveAirbnbThreadKey({
          bookingId: booking.id,
          guestName: guestName || booking.data.guestName || null,
          subject,
          receivedAt,
        }),
        replyToToken,
        parserVersion: PARSER_VERSION,
        source: 'inbound',
      };

      const ref = await firestore.collection('airbnb_messages').add(docData);

      console.log('Written to airbnb_messages', {
        docId: ref.id,
        bookingId: booking.id,
        confirmationCode,
        guestName: docData.guestName,
      });

      processedCount++;
      await markTombstoneCompleted(claim.lockRef);
      continue;
    } catch (err) {
      // Log and continue — one bad record should not block subsequent records
      console.error('Failed to process email record', {
        sesMessageId,
        objectKey,
        error: err.message,
        stack: err.stack,
        code: err.Code ?? err.code,
      });
      errorCount++;
    }
  }

  const summary = {
    total: event.Records?.length ?? 0,
    processed: processedCount,
    quarantined: quarantinedCount,
    skipped: skippedCount,
    errors: errorCount,
  };

  console.log('parse-airbnb-email complete', summary);

  return {
    statusCode: 200,
    body: JSON.stringify(summary),
  };
};

// Exports for unit tests. `exports.handler` remains the Lambda entrypoint.
module.exports.extractEnrichmentFields = extractEnrichmentFields;
module.exports.classifyEmail = classifyEmail;
module.exports.isAirbnbSender = isAirbnbSender;
module.exports.extractGuestNameFromSubject = extractGuestNameFromSubject;
module.exports.extractGuestNameFromBody = extractGuestNameFromBody;
module.exports.resolveGuestNameWithLogging = resolveGuestNameWithLogging;
module.exports.parseResolutionFields = parseResolutionFields;
module.exports.normalizeName = normalizeName;
module.exports.isInActiveWindow = isInActiveWindow;
module.exports.midpointDistance = midpointDistance;
module.exports.tieBreak = tieBreak;
module.exports.WINDOW_PRE_DAYS = WINDOW_PRE_DAYS;
module.exports.WINDOW_POST_DAYS = WINDOW_POST_DAYS;
module.exports.matchByActiveWindow = matchByActiveWindow;
module.exports.findMatchingBooking = findMatchingBooking;
module.exports.extractHeaderRefs = extractHeaderRefs;
module.exports.findParentMessageDocId = findParentMessageDocId;
module.exports.extractAirbnbReplyToToken = extractAirbnbReplyToToken;
module.exports.airbnbThreadKeyFromReplyTo = airbnbThreadKeyFromReplyTo;
module.exports.extractStayWindowFromSubject = extractStayWindowFromSubject;
module.exports.extractStayYearFromSubject = extractStayYearFromSubject;
module.exports.deriveAirbnbThreadKey = deriveAirbnbThreadKey;
