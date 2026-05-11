'use strict';

/**
 * Cascade verification — confirms that when extractGuestNameFromBody yields
 * the correct guest name (e.g. "Jaydon"), the tier-3 booking match in
 * findMatchingBooking actually fires against a Jaydon booking with an active
 * stay window. This is the load-bearing end-to-end property of Fix 1.
 *
 * No production code is exercised by Fix 3; this test only proves the cascade
 * works once Fix 1 is in place.
 */

const { findMatchingBooking } = require('../index');

// Minimal Firestore mock — same shape as booking-match.test.js.
function mockFirestore({ byField = {} } = {}) {
  return {
    collection(name) {
      if (name !== 'bookings') throw new Error(`unexpected collection: ${name}`);
      return {
        _filters: [],
        where(field, op, value) {
          if (op !== '==') throw new Error(`unsupported op: ${op}`);
          this._filters.push({ field, value });
          return this;
        },
        limit() { return this; },
        async get() {
          const filter = this._filters[0];
          if (!filter) return { empty: true, docs: [] };
          const docs = (byField[filter.field] || []).filter(
            (d) => d._matchValue === filter.value
          );
          return {
            empty: docs.length === 0,
            docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
          };
        },
      };
    },
  };
}

describe('cascade — extracted guestName flows into tier-3 booking match', () => {
  const recv = new Date('2026-05-09T15:00:00Z');

  test('extracted "Jaydon" matches Jaydon booking with active 2026-05-05..2026-05-13 window', async () => {
    const firestore = mockFirestore({
      byField: {
        airbnbConfirmationCode: [], // no code in the email
        guestEmail: [], // sender is express@airbnb.com — never on bookings.guestEmail
        guestName: [
          {
            id: 'booking-jaydon-001',
            _matchValue: 'jaydon', // lowercased per normalizeName
            data: {
              guestName: 'jaydon',
              checkInDate: '2026-05-05',
              checkOutDate: '2026-05-13',
            },
          },
        ],
      },
    });

    const result = await findMatchingBooking(firestore, {
      confirmationCode: null,
      fromAddress: 'express@airbnb.com',
      guestName: 'Jaydon',
      receivedAt: recv,
    });

    expect(result).not.toBeNull();
    expect(result.tier).toBe(3);
    expect(result.id).toBe('booking-jaydon-001');
  });
});
