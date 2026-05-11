'use strict';

/**
 * Tests for deriveAirbnbThreadKey — the v2 composite-key threading.
 *
 * Priority chain (each maps to a threadKeyPath tag emitted alongside the key
 * for observability):
 *   1. bookingId         → "booking:<id>"            path = 'booking'
 *   2. guestName + stay  → "guest:<sha16>" of (name | window | year)
 *                                                    path = 'guest-stay'
 *   3. guestName only    → "guest:<sha16>" of (name | yearMonth)
 *                                                    path = 'guest-month'
 *   4. otherwise         → "unknown"                 path = 'unknown'
 *
 * The multi-message merge property is the central thing v2 has to enforce:
 * two emails for the same logical conversation (same bookingId, OR same
 * guest+stay) MUST collapse to the same threadKey.
 *
 * Return shape: { threadKey, threadKeyPath }
 */

const { deriveAirbnbThreadKey } = require('../index');

describe('deriveAirbnbThreadKey', () => {
  test('returns "booking:<id>" with path=booking when bookingId is provided', () => {
    const r = deriveAirbnbThreadKey({
      bookingId: 'abc123',
      guestName: 'Jaydon',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(r.threadKey).toBe('booking:abc123');
    expect(r.threadKeyPath).toBe('booking');
  });

  test('returns "guest:<hash>" with path=guest-stay when guestName + stayWindow extracted', () => {
    const r = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for Casa Coqui #1 Next to everything, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(r.threadKey).toMatch(/^guest:[a-f0-9]{16}$/);
    expect(r.threadKeyPath).toBe('guest-stay');
  });

  test('returns path=guest-month when stayWindow not extractable', () => {
    const r = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'Some Airbnb subject with no date range',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(r.threadKey).toMatch(/^guest:[a-f0-9]{16}$/);
    expect(r.threadKeyPath).toBe('guest-month');
  });

  test('returns "unknown" with path=unknown when guestName is null', () => {
    const r = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: null,
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(r.threadKey).toBe('unknown');
    expect(r.threadKeyPath).toBe('unknown');
  });

  test('returns "unknown" with path=unknown when guestName is "Unknown sender"', () => {
    const r = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Unknown sender',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(r.threadKey).toBe('unknown');
    expect(r.threadKeyPath).toBe('unknown');
  });

  test('multi-message merge: two emails with same bookingId produce identical threadKey', () => {
    const r1 = deriveAirbnbThreadKey({
      bookingId: 'book-xyz',
      guestName: 'Jaydon',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    const r2 = deriveAirbnbThreadKey({
      bookingId: 'book-xyz',
      // Even with no name/subject — bookingId wins
      guestName: null,
      subject: '',
      receivedAt: new Date('2026-05-10T15:00:00Z'),
    });
    expect(r1.threadKey).toBe(r2.threadKey);
    expect(r1.threadKeyPath).toBe('booking');
    expect(r2.threadKeyPath).toBe('booking');
  });

  test('multi-message merge: same guestName + same stayWindow produce identical threadKey', () => {
    const r1 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for Casa Coqui #1, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    const r2 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for Casa Coqui #1 Next to everything, May 5 – 13',
      receivedAt: new Date('2026-05-09T08:00:00Z'),
    });
    expect(r1.threadKey).toBe(r2.threadKey);
    expect(r1.threadKeyPath).toBe('guest-stay');
  });

  test('separation: same guestName but DIFFERENT stayWindows produce different threadKeys', () => {
    const r1 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    const r2 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'RE: Reservation for X, Jun 8 – 14',
      receivedAt: new Date('2026-06-09T12:00:00Z'),
    });
    expect(r1.threadKey).not.toBe(r2.threadKey);
  });

  test('lowercases guestName before hashing — case is irrelevant', () => {
    const r1 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Leslie',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    const r2 = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'leslie',
      subject: 'RE: Reservation for X, May 5 – 13',
      receivedAt: new Date('2026-05-06T12:00:00Z'),
    });
    expect(r1.threadKey).toBe(r2.threadKey);
  });

  test('falls back gracefully when receivedAt is an ISO string', () => {
    const r = deriveAirbnbThreadKey({
      bookingId: null,
      guestName: 'Jaydon',
      subject: 'No date here',
      receivedAt: '2026-05-06T12:00:00Z',
    });
    expect(r.threadKey).toMatch(/^guest:[a-f0-9]{16}$/);
    expect(r.threadKeyPath).toBe('guest-month');
  });
});
