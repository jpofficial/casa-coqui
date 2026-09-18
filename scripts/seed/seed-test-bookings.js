#!/usr/bin/env node
/**
 * Seed synthetic test bookings + unmatched messages for browser spot-checking
 * the welcome-drafts UI (Task 19).
 *
 * Every doc created is tagged with `_test: true` so you can wipe them later
 * with `scripts/debug/cleanup-test-bookings.js`.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json \
 *     node scripts/seed/seed-test-bookings.js
 */

const crypto = require('crypto');
const admin = require('firebase-admin');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS before running this script.');
  process.exit(1);
}
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const db = admin.firestore();

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function mkCode() {
  return crypto.randomBytes(5).toString('hex');
}

const WELCOME_SAMPLE = (name) =>
  `¡Hola ${name}! 🌴\n\nSo excited to have you coming to Casa Coqui! Everything's ready for your arrival. Here's your guest portal with all the details: https://casa-coqui.cc/g/demo\n\n¡Bienvenido!\nJulio`;

// ------------------------------------------------------------------
// Test bookings — one per state the UI renders
// ------------------------------------------------------------------
const TEST_BOOKINGS = [
  {
    guestName: '[TEST] Edwin Antonio',
    unit: 'Coqui Cielo',
    unitId: 'unit-a',
    checkInDate: daysFromNow(7),
    checkOutDate: daysFromNow(12),
    status: 'active',
    welcomeStatus: 'ready',
    welcomeMessage: WELCOME_SAMPLE('Edwin'),
    welcomeDraftedAt: new Date().toISOString(),
    note: 'Drafts tab — first card, should auto-expand',
  },
  {
    guestName: '[TEST] Sarah Kim',
    unit: 'Coqui Alta',
    unitId: 'unit-b',
    checkInDate: daysFromNow(14),
    checkOutDate: daysFromNow(18),
    status: 'active',
    welcomeStatus: 'ready',
    welcomeMessage: WELCOME_SAMPLE('Sarah'),
    welcomeDraftedAt: new Date().toISOString(),
    note: 'Drafts tab — second card, collapsed',
  },
  {
    guestName: '[TEST] Maria Santos',
    unit: 'Coqui Cielo',
    unitId: 'unit-a',
    checkInDate: daysFromNow(-1),
    checkOutDate: daysFromNow(2),
    status: 'active',
    welcomeStatus: 'sent',
    welcomeMessage: WELCOME_SAMPLE('Maria'),
    welcomeSentAt: new Date().toISOString(),
    note: 'In-house tab — checked in',
  },
  {
    guestName: '[TEST] Marco Delgado',
    unit: 'Coqui Alta',
    unitId: 'unit-b',
    checkInDate: daysFromNow(21),
    checkOutDate: daysFromNow(25),
    status: 'active',
    welcomeStatus: 'pending',
    welcomeMessage: null,
    note: 'Upcoming tab — generating pill',
  },
  {
    guestName: '[TEST] John Rivera',
    unit: 'Coqui Cielo',
    unitId: 'unit-a',
    checkInDate: daysFromNow(30),
    checkOutDate: daysFromNow(34),
    status: 'active',
    welcomeStatus: 'snoozed',
    welcomeMessage: WELCOME_SAMPLE('John'),
    welcomeSnoozedUntil: daysFromNow(29) + 'T13:00:00.000Z',
    note: 'Upcoming tab — snoozed pill (not visible in Drafts)',
  },
  {
    guestName: '[TEST] Ana Martinez',
    unit: 'Coqui Alta',
    unitId: 'unit-b',
    checkInDate: daysFromNow(45),
    checkOutDate: daysFromNow(49),
    status: 'active',
    welcomeStatus: 'error',
    welcomeMessage: null,
    welcomeError: 'Anthropic API timed out — click Retry',
    note: 'Upcoming tab — error pill + Retry button',
  },
  {
    guestName: '[TEST] Carlos Ruiz',
    unit: 'Coqui Alta',
    unitId: 'unit-b',
    checkInDate: daysFromNow(-14),
    checkOutDate: daysFromNow(-10),
    status: 'active',
    welcomeStatus: 'sent',
    welcomeMessage: WELCOME_SAMPLE('Carlos'),
    welcomeSentAt: new Date(Date.now() - 86400000 * 12).toISOString(),
    note: 'Past tab',
  },
];

// ------------------------------------------------------------------
// Synthetic unmatched inbound messages for /admin/messages
// ------------------------------------------------------------------
const UNMATCHED_MESSAGES = [
  {
    guestName: '[TEST] Unknown Guest 1',
    senderEmail: 'test-unmatched-1@example.com',
    threadKey: 'email:test-unmatched-1@example.com',
    body: 'Hi! I just booked for next month but had a question about parking.',
  },
  {
    guestName: '[TEST] Unknown Guest 2',
    senderEmail: 'test-unmatched-2@example.com',
    threadKey: 'email:test-unmatched-2@example.com',
    body: 'What time is check-in? Our flight lands around 2pm.',
  },
];

async function main() {
  console.log(`Seeding ${TEST_BOOKINGS.length} bookings + ${UNMATCHED_MESSAGES.length} unmatched messages...`);
  console.log('All docs tagged with { _test: true } for easy cleanup.\n');

  const appUrl = process.env.APP_URL || 'https://casa-coqui.cc';
  const now = new Date().toISOString();
  let bookingIds = [];

  for (const b of TEST_BOOKINGS) {
    const code = mkCode();
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
    const doc = {
      _test: true,
      code,
      unit: b.unit,
      unitId: b.unitId,
      guestName: b.guestName,
      guestEmail: '',
      checkInDate: b.checkInDate,
      checkOutDate: b.checkOutDate,
      status: b.status,
      checkedIn: false,
      source: 'test_seed',
      externalId: null,
      createdAt: now,
      guestLink: `${appUrl}/g/${code}?t=${accessToken}`,
      accessTokenHash,
      accessTokenCreatedAt: now,
      accessTokenRevokedAt: null,
      welcomeStatus: b.welcomeStatus,
      welcomeMessage: b.welcomeMessage || null,
      welcomeDraftedAt: b.welcomeDraftedAt || null,
      welcomeSentAt: b.welcomeSentAt || null,
      welcomeSnoozedUntil: b.welcomeSnoozedUntil || null,
      welcomeError: b.welcomeError || null,
      airbnbConfirmationCode: null,
    };
    const ref = await db.collection('bookings').add(doc);
    bookingIds.push({ id: ref.id, code, note: b.note });
    console.log(`  ✓ ${b.guestName.padEnd(28)} → ${b.welcomeStatus.padEnd(10)} (${b.note})`);
  }

  for (const m of UNMATCHED_MESSAGES) {
    const doc = {
      _test: true,
      bookingId: null,
      bookingCode: null,
      threadKey: m.threadKey,
      guestName: m.guestName,
      senderEmail: m.senderEmail,
      fromAddress: m.senderEmail,
      direction: 'inbound',
      sender: 'guest',
      body: m.body,
      source: 'inbound',
      read: false,
      receivedAt: admin.firestore.Timestamp.now(),
      createdAt: admin.firestore.Timestamp.now(),
      draftStatus: null,
    };
    await db.collection('airbnb_messages').add(doc);
    console.log(`  ✓ ${m.guestName.padEnd(28)} → unmatched inbound`);
  }

  console.log('\nDone. Open:');
  console.log('  http://localhost:3000/admin/bookings');
  console.log('  http://localhost:3000/admin/messages');
  console.log('\nWhen you\'re done testing, wipe everything with:');
  console.log('  GOOGLE_APPLICATION_CREDENTIALS=./casa-coqui-firebase-adminsdk-fbsvc-25747895e8.json \\');
  console.log('    node scripts/debug/cleanup-test-bookings.js');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
