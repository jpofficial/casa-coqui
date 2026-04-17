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
const Anthropic = require('@anthropic-ai/sdk').default;
const { buildThreadKey } = require('./thread-key');

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
 * @typedef {'reservation_confirmation' | 'guest_message' | 'payout' | 'review_request' | 'policy_update' | 'unknown'} MessageType
 */

/**
 * Classify an Airbnb email by its subject line.
 * Returns a MessageType string used to route the doc to the correct collection.
 *
 * @param {string} subject
 * @returns {MessageType}
 */
function classifyEmail(subject) {
  if (!subject) return 'unknown';

  // Reservation confirmations — check BEFORE guest messages
  if (
    /reservation confirmed/i.test(subject) ||
    /new booking confirmed/i.test(subject) ||
    /reservation request from/i.test(subject)
  ) {
    return 'reservation_confirmation';
  }

  // Guest messages
  if (
    /new message from\b/i.test(subject) ||
    /responded to your message/i.test(subject) ||
    /sent you a message/i.test(subject) ||
    /message from your (host|guest)/i.test(subject)
  ) {
    return 'guest_message';
  }

  // Payout / earnings
  if (
    /your payout for/i.test(subject) ||
    /earnings summary/i.test(subject) ||
    /payout sent/i.test(subject) ||
    /payment sent/i.test(subject)
  ) {
    return 'payout';
  }

  // Review requests
  if (
    /review your guest/i.test(subject) ||
    /rate your (experience|stay|guest)/i.test(subject) ||
    /left you a review/i.test(subject) ||
    /write a review/i.test(subject)
  ) {
    return 'review_request';
  }

  // Policy / general Airbnb updates
  if (
    /policy update/i.test(subject) ||
    /terms of service/i.test(subject) ||
    /important update from airbnb/i.test(subject) ||
    /airbnb update/i.test(subject)
  ) {
    return 'policy_update';
  }

  return 'unknown';
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

  return null;
}

// ---------------------------------------------------------------------------
// Reservation detail extraction
// ---------------------------------------------------------------------------

/**
 * Month name → 0-indexed month number.
 */
const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Parse a short date like "Sat, May 23" into YYYY-MM-DD using the email's
 * received year. If check-in month is before the received month, assume next year.
 *
 * @param {string} dateStr - e.g. "Sat, May 23" or "May 23"
 * @param {Date} receivedAt
 * @returns {string | null} - YYYY-MM-DD or null
 */
function parseShortDate(dateStr, receivedAt) {
  if (!dateStr) return null;

  // Match patterns like "Sat, May 23" or "May 23" or "May 23, 2026"
  const m = dateStr.match(/(?:\w+,\s*)?(\w+)\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if (!m) return null;

  const monthStr = m[1].toLowerCase();
  const day = parseInt(m[2], 10);
  const explicitYear = m[3] ? parseInt(m[3], 10) : null;

  const monthIdx = MONTHS[monthStr];
  if (monthIdx === undefined || isNaN(day)) return null;

  let year = explicitYear || receivedAt.getFullYear();
  // If no explicit year and month is before received month, assume next year
  if (!explicitYear && monthIdx < receivedAt.getMonth()) {
    year++;
  }

  const mm = String(monthIdx + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Extract reservation details from an Airbnb confirmation email.
 *
 * @param {string} subject
 * @param {string} body
 * @param {Date} receivedAt
 * @returns {object}
 */
function extractReservationDetails(subject, body, receivedAt) {
  const details = {
    guestName: null,
    checkInDate: null,
    checkOutDate: null,
    guestCount: null,
    confirmationCode: null,
    listingTitle: null,
    payoutAmount: null,
    guestMessage: null,
  };

  // Confirmation code — reuse existing extractor
  details.confirmationCode =
    extractConfirmationCode(subject) || extractConfirmationCode(body);

  // Guest name from subject: "Reservation confirmed - Angelina Pascual arrives May 23"
  let m = subject.match(/(?:confirmed|booking)\s*[-–—]\s*(.+?)\s+arrives?\b/i);
  if (m) details.guestName = m[1].trim();

  // Fallback: "Reservation request from Angelina Pascual"
  if (!details.guestName) {
    m = subject.match(/request from\s+(.+?)(?:\s*[-–—]|$)/i);
    if (m) details.guestName = m[1].trim();
  }

  // Check-in date: look for "Check-in" followed by a date
  m = body.match(/Check-?in\s*[\n\r]+\s*(.+)/i);
  if (m) details.checkInDate = parseShortDate(m[1].trim(), receivedAt);

  // Fallback: inline "Check-in: May 23"
  if (!details.checkInDate) {
    m = body.match(/Check-?in[:\s]+(\w+,?\s+\w+\s+\d{1,2}(?:,?\s*\d{4})?)/i);
    if (m) details.checkInDate = parseShortDate(m[1].trim(), receivedAt);
  }

  // Checkout date
  m = body.match(/Check-?out\s*[\n\r]+\s*(.+)/i);
  if (m) details.checkOutDate = parseShortDate(m[1].trim(), receivedAt);

  if (!details.checkOutDate) {
    m = body.match(/Check-?out[:\s]+(\w+,?\s+\w+\s+\d{1,2}(?:,?\s*\d{4})?)/i);
    if (m) details.checkOutDate = parseShortDate(m[1].trim(), receivedAt);
  }

  // Guest count: "7 adults" or "2 guests"
  m = body.match(/(\d+)\s+(?:adults?|guests?)/i);
  if (m) details.guestCount = parseInt(m[1], 10);

  // Listing title: look for the listing name between quotes or before "Entire home"
  // Common patterns in Airbnb emails
  m = body.match(/(?:Listing|Property)[:\s]*([^\n]+)/i);
  if (m) details.listingTitle = m[1].trim();

  // Fallback: text before "Entire home/apt" or "Entire rental unit"
  if (!details.listingTitle) {
    m = body.match(/([^\n]{10,})\s*\n\s*Entire (?:home|rental|apartment)/i);
    if (m) details.listingTitle = m[1].trim();
  }

  // Payout amount: "$774.40" near "total" or "Guest paid" or "You earn"
  m = body.match(/(?:total|guest paid|you earn|payout)[^$]*\$([0-9,]+\.?\d*)/i);
  if (m) details.payoutAmount = parseFloat(m[1].replace(/,/g, ''));

  // Guest intro message: typically a quoted block or paragraph after the guest name
  // Look for text between "Message from" and the next section break
  m = body.match(/(?:Message from .+?|"([^"]+)")\s*\n/i);
  if (m && m[1]) details.guestMessage = m[1].trim();

  // Fallback: look for a quoted paragraph
  if (!details.guestMessage) {
    m = body.match(/"([^"]{20,})"/);
    if (m) details.guestMessage = m[1].trim();
  }

  return details;
}

// ---------------------------------------------------------------------------
// Booking creation from reservation confirmation
// ---------------------------------------------------------------------------

/**
 * Create a full booking from a parsed reservation confirmation email.
 * Mirrors the logic in POST /api/bookings (route.js lines 102-225).
 *
 * @param {object} details - from extractReservationDetails()
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {object | null} propertySettings - settings/property doc data
 * @param {Date} receivedAt
 * @returns {Promise<{ bookingId: string, code: string } | null>}
 */
async function createBookingFromConfirmation(details, firestore, propertySettings, receivedAt) {
  const { confirmationCode, guestName, checkInDate, checkOutDate, guestCount, listingTitle, payoutAmount, guestMessage } = details;

  if (!checkInDate || !checkOutDate) {
    console.warn('Cannot create booking — missing dates', { checkInDate, checkOutDate });
    return null;
  }

  // 1. Deduplicate: if booking already exists (e.g. from ICS sync), enrich it
  //    with the guest name and trigger welcome generation instead of skipping.
  if (confirmationCode) {
    const existing = await firestore
      .collection('bookings')
      .where('airbnbConfirmationCode', '==', confirmationCode)
      .limit(1)
      .get();

    if (!existing.empty) {
      const existingDoc = existing.docs[0];
      const existingData = existingDoc.data();
      const existingId = existingDoc.id;

      // Enrich: update guest name if the existing record has a generic name
      const genericNames = ['airbnb guest', 'guest', ''];
      const existingNameGeneric = genericNames.includes((existingData.guestName || '').toLowerCase().trim());
      const hasRealName = guestName && !genericNames.includes(guestName.toLowerCase().trim());

      const enrichUpdates = {};
      if (existingNameGeneric && hasRealName) {
        enrichUpdates.guestName = guestName.trim();
        console.log('Enriching existing booking with guest name from email', { existingId, guestName });
      }

      // Enrich: fill in missing fields from the reservation email
      if (guestCount && !existingData.guestCount) enrichUpdates.guestCount = guestCount;
      if (payoutAmount && !existingData.payoutAmount) enrichUpdates.payoutAmount = payoutAmount;
      if (guestMessage && !existingData.guestMessage) enrichUpdates.guestMessage = guestMessage;

      if (Object.keys(enrichUpdates).length > 0) {
        enrichUpdates.enrichedFromEmailAt = new Date().toISOString();
        await firestore.collection('bookings').doc(existingId).update(enrichUpdates);
      }

      // Trigger welcome generation if still pending
      if (existingData.welcomeStatus === 'pending' || existingData.welcomeStatus === 'error') {
        console.log('Triggering welcome generation for enriched booking', { existingId });
        return { bookingId: existingId, code: existingData.code, enriched: true };
      }

      console.log('Booking already exists and has welcome message — no action needed', { confirmationCode, existingId });
      return null;
    }
  }

  // 2. Map listing title to unit via listingMappings
  const mappings = propertySettings?.listingMappings || [];
  let unitId = null;
  let unitName = null;

  if (listingTitle) {
    const titleLower = listingTitle.toLowerCase();
    for (const mapping of mappings) {
      if (mapping.listingFragment && titleLower.includes(mapping.listingFragment.toLowerCase())) {
        unitId = mapping.unitId;
        unitName = mapping.unitName;
        break;
      }
    }
  }

  // Fallback to first unit if no mapping matched
  if (!unitId) {
    const units = propertySettings?.units || [];
    if (units.length > 0) {
      const firstUnit = units[0];
      unitId = firstUnit.id || 'unit-a';
      unitName = firstUnit.name || 'Unit A';
    } else {
      unitId = 'unit-a';
      unitName = 'Unit A';
    }
    console.warn('No listing mapping matched — defaulting to first unit', {
      listingTitle,
      unitId,
      unitName,
      mappingsCount: mappings.length,
    });
  }

  // 3. Generate booking code + access token
  const code = crypto.randomBytes(5).toString('hex');
  const accessToken = crypto.randomBytes(32).toString('base64url');
  const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  const appUrl = process.env.APP_URL || 'https://casa-coqui.cc';
  const guestLink = `${appUrl}/g/${code}?t=${accessToken}`;
  const now = new Date().toISOString();

  // 4. Write booking doc
  const booking = {
    code,
    unit: unitName,
    unitId,
    guestName: (guestName || '').trim(),
    guestEmail: '',
    checkInDate,
    checkOutDate,
    status: 'active',
    checkedIn: false,
    source: 'airbnb_email',
    externalId: confirmationCode || null,
    lastSyncedAt: null,
    syncHash: null,
    createdAt: now,
    guestLink,
    accessTokenHash,
    accessTokenCreatedAt: now,
    accessTokenRevokedAt: null,
    welcomeStatus: 'pending',
    welcomeMessage: null,
    welcomeDraftedAt: null,
    welcomeSentAt: null,
    airbnbConfirmationCode: confirmationCode || null,
    guestCount: guestCount || null,
    payoutAmount: payoutAmount || null,
    guestMessage: guestMessage || null,
  };

  const docRef = await firestore.collection('bookings').add(booking);
  console.log('Booking created', { bookingId: docRef.id, code, unitName, confirmationCode });

  // 5. Write booking_members doc (primary guest)
  await firestore.collection('booking_members').add({
    bookingCode: code,
    role: 'primary',
    name: booking.guestName,
    email: '',
    phone: null,
    uid: null,
    status: 'pending',
    invitedBy: null,
    createdAt: now,
  });

  // 6. Write guest_access_log
  await firestore.collection('guest_access_log').doc(code).set({
    bookingCode: code,
    inviteCreatedAt: now,
    linkCopiedAt: null,
    linkOpenedAt: null,
    portalViewedAt: null,
    checkedInAt: null,
    lastSeenAt: null,
    expiredAt: null,
    revokedAt: null,
    pushEnabled: false,
    accessCount: 0,
  });

  // 7. Auto-create checkout cleaning job
  try {
    const cleanerSnap = await firestore
      .collection('users')
      .where('role', '==', 'cleaner')
      .where('status', '==', 'active')
      .get();

    if (cleanerSnap.size >= 1) {
      const cleanerDoc = cleanerSnap.docs[0];
      const cleanerData = cleanerDoc.data();

      const job = {
        unit: unitName,
        scheduledDate: checkOutDate,
        checkoutTime: '11:00 AM',
        assigneeId: cleanerDoc.id,
        assigneeName: cleanerData.displayName || cleanerData.email,
        bookingId: docRef.id,
        status: 'scheduled',
        source: 'airbnb_email',
        manualOverride: false,
        notes: guestName ? `Guest: ${guestName}` : '',
        turnoverNotes: '',
        sameDayArrival: false,
        beforePhotos: [],
        afterPhotos: [],
        issues: [],
        laundryFound: null,
        laundryNote: '',
        laundryPhoto: null,
        acknowledgedAt: null,
        enRouteAt: null,
        arrivedAt: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        createdBy: 'system',
      };

      const jobRef = await firestore.collection('cleaning_jobs').add(job);
      console.log('Cleaning job created', { jobId: jobRef.id, unit: unitName, date: checkOutDate });
    }
  } catch (err) {
    console.error('Auto-create cleaning job error (non-fatal)', err.message);
  }

  // 8. Write in-app staff notification + send FCM push for admin/cohost
  try {
    const staffSnap = await firestore
      .collection('users')
      .where('role', 'in', ['admin', 'cohost'])
      .where('status', '==', 'active')
      .get();

    const staffIds = staffSnap.docs.map((d) => d.id);
    const notifTitle = 'New Airbnb Booking';
    const notifBody = `${guestName || 'Guest'} — ${unitName} — ${checkInDate} to ${checkOutDate}`;
    const notifData = { bookingId: docRef.id, targetPath: '/admin/bookings' };

    await Promise.all(
      staffIds.map(async (staffId) => {
        // In-app notification (bell icon)
        await firestore.collection('staff_notifications').add({
          recipientId: staffId,
          title: notifTitle,
          body: notifBody,
          type: 'booking',
          data: notifData,
          read: false,
          readAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // FCM push to every registered device for this staff member
        try {
          const tokensSnap = await firestore
            .collection('fcm_tokens')
            .where('staffId', '==', staffId)
            .get();

          await Promise.all(
            tokensSnap.docs.map(async (tokenDoc) => {
              const { token } = tokenDoc.data();
              if (!token) return;
              try {
                await admin.messaging().send({
                  token,
                  data: {
                    title: notifTitle,
                    body: notifBody,
                    type: 'booking',
                    bookingId: docRef.id,
                    targetPath: '/admin/bookings',
                  },
                });
              } catch (sendErr) {
                console.warn(`FCM send error for staff ${staffId}:`, sendErr.message);
              }
            })
          );
        } catch (tokenErr) {
          console.warn(`FCM token fetch error for staff ${staffId}:`, tokenErr.message);
        }
      })
    );
    console.log('Staff notifications sent', { staffCount: staffIds.length });
  } catch (err) {
    console.error('Staff notification error (non-fatal)', err.message);
  }

  return { bookingId: docRef.id, code };
}

// ---------------------------------------------------------------------------
// Welcome message generation (mirrors functions/lib/welcome-ai.js)
// ---------------------------------------------------------------------------

/** @type {string | null} */
let cachedAnthropicKey = null;

/**
 * Fetch the Anthropic API key from Secrets Manager (cached per container).
 * @returns {Promise<string>}
 */
async function getAnthropicApiKey() {
  if (cachedAnthropicKey) return cachedAnthropicKey;

  const secretName = process.env.ANTHROPIC_SECRET_NAME || 'casa-coqui/anthropic-api-key';
  const resp = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  cachedAnthropicKey = resp.SecretString;
  return cachedAnthropicKey;
}

const WELCOME_SYSTEM_PROMPT = `You are drafting a welcome message for a short-term rental guest on behalf of Julio, the host of Casa Coqui in San Juan, Puerto Rico. Julio is warm, friendly, and helpful — not overly formal.

YOUR RULES:
1. Write in the guest's likely language. If the guest name suggests Spanish, write in Spanish. Otherwise default to English. If a language is explicitly requested, use that.
2. Keep the message concise — 3-4 short paragraphs max. Guests are reading this on their phone.
3. Start with a warm thank-you for booking and genuine excitement about hosting them.
4. The guest portal link is the KEY part of the message. Sell its value — tell the guest it has:
   - Step-by-step check-in instructions with photos
   - WiFi details, house rules, and property info
   - Laundry availability and parking details
   - Everything they need for a smooth stay
   Place the link on its own line so it's easy to tap. Emphasize it's quick and easy — no password needed, just tap the link.
5. Mention that you'll also send more info closer to their arrival date, and that all communication should stay here on Airbnb.
6. End with an invitation to reach out with questions. Sign off as "Julio".
7. Do NOT include specific check-in instructions, WiFi passwords, or door codes — those are in the guest portal.
8. Do NOT use generic hotel language. Sound like a real person, not a template.
9. Do NOT use emojis excessively — one or two max is fine.
10. If a template/example is provided, match its tone and structure closely.
11. Mention the unit name naturally if it has a friendly name.
12. Keep it under 200 words.`;

const WELCOME_TOOL = {
  name: 'welcome_message',
  description: 'Generate a personalized welcome message for an incoming guest',
  input_schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The welcome message text' },
      language: { type: 'string', enum: ['en', 'es'], description: 'Language used' },
    },
    required: ['message', 'language'],
  },
};

/**
 * Generate a welcome message draft and update the booking doc.
 * Non-fatal: logs errors but does not throw.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string} bookingId
 * @param {object} booking - booking doc data
 * @param {object | null} settings - property settings
 */
async function generateWelcomeDraft(firestore, bookingId, booking, settings) {
  try {
    const apiKey = await getAnthropicApiKey();
    const client = new Anthropic({ apiKey });

    const checkIn = booking.checkInDate;
    const checkOut = booking.checkOutDate;
    const nightCount = checkIn && checkOut
      ? Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)
      : null;

    const input = JSON.stringify({
      guest: { name: booking.guestName || 'Guest', confirmationCode: booking.airbnbConfirmationCode },
      stay: { unit: booking.unit, checkInDate: checkIn, checkOutDate: checkOut, nightCount },
      property: { name: settings?.propertyName || 'Casa Coqui', location: settings?.location || 'San Juan, Puerto Rico' },
      guestPortalLink: booking.guestLink || null,
    });

    const startTime = Date.now();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: WELCOME_SYSTEM_PROMPT,
      tools: [WELCOME_TOOL],
      tool_choice: { type: 'tool', name: 'welcome_message' },
      messages: [{ role: 'user', content: input }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse) {
      console.error('Welcome AI did not return structured output');
      return;
    }

    const now = new Date().toISOString();
    await firestore.collection('bookings').doc(bookingId).update({
      welcomeStatus: 'ready',
      welcomeMessage: toolUse.input.message,
      welcomeDraftedAt: now,
    });

    // Log agent run for observability
    await firestore.collection('agent_runs').add({
      kind: 'welcome',
      refId: bookingId,
      model: 'claude-haiku-4-5-20251001',
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      latencyMs: Date.now() - startTime,
      prompt: input,
      response: JSON.stringify(toolUse.input),
      escalated: false,
      createdAt: now,
    });

    console.log('Welcome message generated', {
      bookingId,
      language: toolUse.input.language,
      latencyMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error('Welcome message generation failed', {
      bookingId,
      error: err.message,
    });
    // Record the failure so the admin UI can surface a Retry button.
    try {
      await firestore.collection('bookings').doc(bookingId).update({
        welcomeStatus: 'error',
        welcomeError: err.message ? String(err.message).slice(0, 500) : 'unknown',
      });
    } catch (updateErr) {
      console.error('Failed to persist welcome error state', updateErr.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Booking match
// ---------------------------------------------------------------------------

/**
 * Try to find a Firestore booking document that matches either the
 * Airbnb confirmation code or (fallback) the guest name within an active
 * date range.
 *
 * @param {import('firebase-admin').firestore.Firestore} firestore
 * @param {string | null} confirmationCode
 * @param {string | null} guestName
 * @param {Date} receivedAt
 * @returns {Promise<{ id: string, data: object } | null>}
 */
async function findMatchingBooking(firestore, confirmationCode, guestName, receivedAt) {
  const bookingsRef = firestore.collection('bookings');

  // Primary: exact confirmation code match
  if (confirmationCode) {
    const snap = await bookingsRef
      .where('airbnbConfirmationCode', '==', confirmationCode)
      .limit(1)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];
      return { id: doc.id, data: doc.data() };
    }
  }

  // Fallback: guest name + email date falls within checkIn/checkOut
  if (guestName) {
    // Normalise: lowercase, trim
    const nameLower = guestName.toLowerCase().trim();

    // Fetch bookings where checkOut >= now (still active or future)
    const nowTs = admin.firestore.Timestamp.fromDate(receivedAt);
    const snap = await bookingsRef
      .where('checkOut', '>=', nowTs)
      .where('status', 'in', ['active', 'confirmed'])
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      const docGuestName = (data.guestName || data.primaryGuestName || '').toLowerCase().trim();

      if (docGuestName && docGuestName.includes(nameLower)) {
        // Also verify receivedAt >= checkIn to avoid early matches
        const checkInDate = data.checkIn?.toDate ? data.checkIn.toDate() : null;
        if (!checkInDate || receivedAt >= checkInDate) {
          return { id: doc.id, data };
        }
      }
    }
  }

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

      console.log('Email parsed', {
        subject,
        fromAddress,
        fromName,
        receivedAt: receivedAt.toISOString(),
        rfcMessageId,
        bodyLength: bodyText.length,
      });

      // ------------------------------------------------------------------
      // 3. Classify message type
      // ------------------------------------------------------------------
      const messageType = classifyEmail(subject);

      console.log('Email classified', { messageType, subject });

      // ------------------------------------------------------------------
      // 4. Extract confirmation code + guest name
      // ------------------------------------------------------------------
      const confirmationCode =
        extractConfirmationCode(subject) || extractConfirmationCode(bodyText);

      const guestName =
        extractGuestNameFromSubject(subject) || fromName || null;

      console.log('Extracted fields', { confirmationCode, guestName });

      // ------------------------------------------------------------------
      // 5. Get Firestore client
      // ------------------------------------------------------------------
      const firestore = await getFirestore();

      // ------------------------------------------------------------------
      // 6. Route reservation confirmations → auto-create booking
      // ------------------------------------------------------------------
      if (messageType === 'reservation_confirmation') {
        console.log('Reservation confirmation detected — extracting details');

        const reservationDetails = extractReservationDetails(subject, bodyText, receivedAt);
        console.log('Reservation details extracted', reservationDetails);

        // Load property settings for listing → unit mapping
        let propertySettings = null;
        try {
          const settingsDoc = await firestore.doc('settings/property').get();
          if (settingsDoc.exists) propertySettings = settingsDoc.data();
        } catch (err) {
          console.warn('Failed to load property settings (non-fatal)', err.message);
        }

        const result = await createBookingFromConfirmation(
          reservationDetails,
          firestore,
          propertySettings,
          receivedAt
        );

        // Archive to quarantine for record-keeping
        const alreadyArchived = await isDuplicate(
          firestore,
          'airbnb_messages_quarantine',
          objectKey,
          rfcMessageId
        );

        if (!alreadyArchived) {
          await firestore.collection('airbnb_messages_quarantine').add({
            messageType,
            subject,
            fromName,
            fromAddress,
            body: bodyText.slice(0, 4000),
            receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
            rawEmailS3Key: objectKey,
            messageId: rfcMessageId,
            sesMessageId,
            airbnbConfirmationCode: reservationDetails.confirmationCode || confirmationCode,
            quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
            reason: result
              ? (result.enriched ? 'reservation_confirmation:booking_enriched' : 'reservation_confirmation:booking_created')
              : 'reservation_confirmation:skipped',
            bookingId: result?.bookingId || null,
          });
        }

        if (result) {
          console.log('Booking auto-created from reservation confirmation', result);

          // Generate welcome message draft (non-blocking failure)
          const bookingDoc = await firestore.collection('bookings').doc(result.bookingId).get();
          await generateWelcomeDraft(firestore, result.bookingId, bookingDoc.data(), propertySettings);

          processedCount++;
        } else {
          console.log('Reservation confirmation processed — no new booking (duplicate or missing data)');
          quarantinedCount++;
        }
        continue;
      }

      // ------------------------------------------------------------------
      // 6b. Route other non-guest-message emails straight to quarantine
      // ------------------------------------------------------------------
      if (messageType !== 'guest_message') {
        console.log('Non-guest message — routing to quarantine', { messageType });

        const alreadyQuarantined = await isDuplicate(
          firestore,
          'airbnb_messages_quarantine',
          objectKey,
          rfcMessageId
        );

        if (alreadyQuarantined) {
          console.log('Duplicate quarantine record — skipping', { objectKey, rfcMessageId });
          skippedCount++;
          continue;
        }

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
          quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: `messageType:${messageType}`,
        });

        console.log('Written to airbnb_messages_quarantine', { messageType, objectKey });
        quarantinedCount++;
        continue;
      }

      // ------------------------------------------------------------------
      // 7. Idempotency check against airbnb_messages
      // ------------------------------------------------------------------
      const alreadyProcessed = await isDuplicate(
        firestore,
        'airbnb_messages',
        objectKey,
        rfcMessageId
      );

      if (alreadyProcessed) {
        console.log('Duplicate airbnb_messages record — skipping', { objectKey, rfcMessageId });
        skippedCount++;
        continue;
      }

      // ------------------------------------------------------------------
      // 8. Match to a booking
      // ------------------------------------------------------------------
      const booking = await findMatchingBooking(
        firestore,
        confirmationCode,
        guestName,
        receivedAt
      );

      if (!booking) {
        console.warn('No matching booking found — writing as unmatched', {
          confirmationCode,
          guestName,
        });

        // Idempotency check against airbnb_messages
        const alreadyWritten = await isDuplicate(
          firestore,
          'airbnb_messages',
          objectKey,
          rfcMessageId
        );

        if (!alreadyWritten) {
          // Write to airbnb_messages with null bookingId so it appears in admin UI
          await firestore.collection('airbnb_messages').add({
            bookingId: null,
            guestName: guestName || null,
            direction: 'inbound',
            body: bodyText.slice(0, 8000),
            receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
            rawEmailS3Key: objectKey,
            messageId: rfcMessageId,
            sesMessageId,
            airbnbConfirmationCode: confirmationCode || null,
            subject,
            fromName,
            fromAddress,
            read: false,
            draftReply: null,
            draftStatus: 'pending',
            draftedAt: null,
            sentAt: null,
            editedReply: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            threadKey: buildThreadKey({
              bookingCode: null,
              senderEmail: fromAddress,
              senderName: guestName || fromName,
            }),
            source: 'inbound',
          });

          console.log('Written unmatched guest_message to airbnb_messages');

          // Also archive to quarantine for record-keeping
          await firestore.collection('airbnb_messages_quarantine').add({
            messageType: 'guest_message',
            subject,
            fromName,
            fromAddress,
            body: bodyText.slice(0, 4000),
            receivedAt: admin.firestore.Timestamp.fromDate(receivedAt),
            rawEmailS3Key: objectKey,
            messageId: rfcMessageId,
            sesMessageId,
            airbnbConfirmationCode: confirmationCode,
            guestName,
            quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
            reason: 'no_matching_booking',
          });
        }

        processedCount++;
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
        sesMessageId,
        airbnbConfirmationCode:
          confirmationCode || booking.data.airbnbConfirmationCode || null,
        subject,
        fromAddress,
        // Reply workflow fields — all null on ingest
        draftReply: null,
        draftStatus: 'pending',
        draftedAt: null,
        sentAt: null,
        editedReply: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        threadKey: buildThreadKey({
          bookingCode: booking.data.code,
          senderEmail: fromAddress,
          senderName: guestName || booking.data.guestName || null,
        }),
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
