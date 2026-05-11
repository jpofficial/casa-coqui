'use strict';

/**
 * Tests for deriveAirbnbThreadKey — the v2 composite-key threading.
 *
 * Priority chain:
 *   1. bookingId         → "booking:<id>"
 *   2. guestName + stay  → "guest:<sha10>" of (name | window | year)
 *   3. guestName only    → "guest:<sha10>" of (name | yearMonth)
 *   4. otherwise         → "unknown"
 *
 * The multi-message merge property is the central thing v2 has to enforce:
 * two emails for the same logical conversation (same bookingId, OR same
 * guest+stay) MUST collapse to the same threadKey.
 */

const { deriveAirbnbThreadKey } = require('../index');

describe('deriveAirbnbThreadKey', () => {
  test('returns "booking:<id>" when bookingId is provided', () => {
    const tk = deriveAirbnbThreadKey({
      bookingId: 'abc123',
      guestName: 'Jaydon',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(tk).toBe('booking:abc123');
  });

  test('returns "guest:<hash>" composite when guestName + stayWindow extracted', () => {
    const tk = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for Casa Coqui #1 Next to everything, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(tk).toMatch(/^guest:[a-f0-9]{16}$/);
  });

  test('falls back to year-month composite when stayWindow not extractable', () => {
    const tk = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'Some Airbnb subject with no date range',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    // Should still be a guest:<hash16> — just from the year-month fallback.
    expect(tk).toMatch(/^guest:[a-f0-9]{16}$/);
  });

  test('returns "unknown" when guestName is null', () => {
    const tk = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: null,
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(tk).toBe('unknown');
  });

  test('returns "unknown" when guestName is "Unknown sender"', () => {
    const tk = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Unknown sender',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(tk).toBe('unknown');
  });

  test('multi-message merge: two emails with same bookingId produce identical threadKey', () => {
    const tk1 = deriveAirbnbThreadKey({
      bookingId: 'book-xyz',
      guestName: 'Jaydon',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    const tk2 = deriveAirbnbThreadKey({
      bookingId: 'book-xyz',
      // Even with no name/subject — bookingId wins
      guestName: null,
      subject: '',
      receivedAt: new Date('2026-05-10T15:00:00Z'),
    });
    expect(tk1).toBe(tk2);
  });

  test('multi-message merge: same guestName + same stayWindow produce identical threadKey', () => {
    const tk1 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for Casa Coqui #1, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    const tk2 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for Casa Coqui #1 Next to everything, May 5 – 13',
      receivedAt: new Date('2026-05-09T08:00:00Z'),
    });
    expect(tk1).toBe(tk2);
  });

  test('separation: same guestName but DIFFERENT stayWindows produce different threadKeys', () => {
    const tk1 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    const tk2 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for X, Jun 8 – 14',
      receivedAt: new Date('2026-06-09T12:00:00Z'),
    });
    expect(tk1).not.toBe(tk2);
  });

  test('lowercases guestName before hashing — case is irrelevant', () => {
    const tk1 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Leslie',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    const tk2 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'leslie',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(tk1).toBe(tk2);
  });

  test('falls back gracefully when receivedAt is an ISO string', () => {
    const tk = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'No date here',
      receivedAt: '2026-05-06T12:00:00Z',
    });
    expect(tk).toMatch(/^guest:[a-f0-9]{16}$/);
  });
});
