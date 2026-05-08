'use strict';

const {
  normalizeName,
  isInActiveWindow,
  midpointDistance,
  tieBreak,
  WINDOW_PRE_DAYS,
  WINDOW_POST_DAYS,
} = require('../index');

describe('window constants', () => {
  test('WINDOW_PRE_DAYS = 15', () => {
    expect(WINDOW_PRE_DAYS).toBe(15);
  });
  test('WINDOW_POST_DAYS = 5', () => {
    expect(WINDOW_POST_DAYS).toBe(5);
  });
});

describe('normalizeName', () => {
  test('lowercases', () => {
    expect(normalizeName('Jane DOE')).toBe('jane doe');
  });
  test('collapses internal whitespace', () => {
    expect(normalizeName('Jane    Doe')).toBe('jane doe');
  });
  test('trims', () => {
    expect(normalizeName('  Jane Doe  ')).toBe('jane doe');
  });
  test('preserves accented characters', () => {
    expect(normalizeName('José Pérez')).toBe('josé pérez');
  });
});

describe('isInActiveWindow', () => {
  const recv = new Date('2026-05-07T12:00:00Z');

  test('within stay window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
      recv
    )).toBe(true);
  });

  test('exactly 15 days before checkIn — IN window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-05-22', checkOutDate: '2026-05-25' },
      recv
    )).toBe(true);
  });

  test('16 days before checkIn — OUT of window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-05-23', checkOutDate: '2026-05-25' },
      recv
    )).toBe(false);
  });

  test('exactly 5 days after checkOut — IN window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-04-25', checkOutDate: '2026-05-02' },
      recv
    )).toBe(true);
  });

  test('6 days after checkOut — OUT of window', () => {
    expect(isInActiveWindow(
      { checkInDate: '2026-04-25', checkOutDate: '2026-05-01' },
      recv
    )).toBe(false);
  });

  test('missing dates returns false', () => {
    expect(isInActiveWindow({}, recv)).toBe(false);
    expect(isInActiveWindow({ checkInDate: '2026-05-01' }, recv)).toBe(false);
  });

  test('invalid dates returns false', () => {
    expect(isInActiveWindow(
      { checkInDate: 'not-a-date', checkOutDate: '2026-05-15' },
      recv
    )).toBe(false);
  });
});

describe('midpointDistance', () => {
  test('returns ms distance from receivedAt to stay-midpoint', () => {
    const booking = {
      data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-11' },
    };
    const recv = new Date('2026-05-06T00:00:00Z'); // exactly midpoint
    expect(midpointDistance(booking, recv)).toBe(0);
  });

  test('symmetric: same distance before and after midpoint', () => {
    const booking = {
      data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-11' },
    };
    const before = new Date('2026-05-04T00:00:00Z');
    const after = new Date('2026-05-08T00:00:00Z');
    expect(midpointDistance(booking, before)).toBe(midpointDistance(booking, after));
  });
});

describe('tieBreak', () => {
  const recv = new Date('2026-05-07T12:00:00Z');

  test('returns single candidate as-is', () => {
    const c = { id: 'b1', data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-15' } };
    expect(tieBreak([c], recv)).toBe(c);
  });

  test('prefers active-stay candidate over future-stay', () => {
    const active = { id: 'b1', data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-15' } };
    const future = { id: 'b2', data: { checkInDate: '2026-09-10', checkOutDate: '2026-09-15' } };
    expect(tieBreak([active, future], recv)).toBe(active);
    expect(tieBreak([future, active], recv)).toBe(active); // order independent
  });

  test('falls through to closest-midpoint when no active stay', () => {
    const past = { id: 'b1', data: { checkInDate: '2026-04-01', checkOutDate: '2026-04-08' } };
    const future = { id: 'b2', data: { checkInDate: '2026-09-10', checkOutDate: '2026-09-15' } };
    // Past midpoint Apr 4-5, distance ~33 days. Future midpoint Sep 12-13, distance ~128 days. Past wins.
    expect(tieBreak([past, future], recv)).toBe(past);
  });

  test('two active stays: closest-midpoint wins', () => {
    const a = { id: 'b1', data: { checkInDate: '2026-05-01', checkOutDate: '2026-05-15' } }; // mid May 8
    const b = { id: 'b2', data: { checkInDate: '2026-05-05', checkOutDate: '2026-05-10' } }; // mid May 7-8
    // recv = May 7 noon. Both midpoints close; b should win (smaller distance).
    expect(tieBreak([a, b], recv)).toBe(b);
  });

  test('createdAt-desc breaks midpoint tie', () => {
    const older = {
      id: 'b1',
      data: {
        checkInDate: '2026-04-01',
        checkOutDate: '2026-04-08',
        createdAt: { toMillis: () => 1000 },
      },
    };
    const newer = {
      id: 'b2',
      data: {
        checkInDate: '2026-04-01',
        checkOutDate: '2026-04-08',
        createdAt: { toMillis: () => 2000 },
      },
    };
    expect(tieBreak([older, newer], recv)).toBe(newer);
  });
});

const { matchByActiveWindow, findMatchingBooking } = require('../index');

// Minimal Firestore mock. Each .where().get() returns whatever was queued.
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
          // Return the first filter's matching docs from byField.
          const filter = this._filters[0];
          if (!filter) return { empty: true, docs: [] };
          const docs = (byField[filter.field] || []).filter(d => d._matchValue === filter.value);
          return {
            empty: docs.length === 0,
            docs: docs.map(d => ({ id: d.id, data: () => d.data })),
          };
        },
      };
    },
  };
}

describe('matchByActiveWindow', () => {
  const recv = new Date('2026-05-07T12:00:00Z');

  test('returns null when no rows match the equality query', async () => {
    const fs = mockFirestore({ byField: { guestEmail: [] } });
    const result = await matchByActiveWindow(fs, 'guestEmail', 'jane@x.com', recv);
    expect(result).toBeNull();
  });

  test('returns null when row matches but window does not', async () => {
    const fs = mockFirestore({
      byField: {
        guestEmail: [{
          id: 'b1',
          _matchValue: 'jane@x.com',
          data: { guestEmail: 'jane@x.com', checkInDate: '2025-01-01', checkOutDate: '2025-01-05' },
        }],
      },
    });
    const result = await matchByActiveWindow(fs, 'guestEmail', 'jane@x.com', recv);
    expect(result).toBeNull();
  });

  test('returns the booking when row matches AND window matches', async () => {
    const fs = mockFirestore({
      byField: {
        guestEmail: [{
          id: 'b1',
          _matchValue: 'jane@x.com',
          data: { guestEmail: 'jane@x.com', checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
        }],
      },
    });
    const result = await matchByActiveWindow(fs, 'guestEmail', 'jane@x.com', recv);
    expect(result.id).toBe('b1');
    expect(result.data.guestEmail).toBe('jane@x.com');
  });
});

describe('findMatchingBooking — tiered chain', () => {
  const recv = new Date('2026-05-07T12:00:00Z');

  test('Tier 1: confirmation code match wins immediately', async () => {
    const fs = mockFirestore({
      byField: {
        airbnbConfirmationCode: [{
          id: 'b1',
          _matchValue: 'HMABCDEFGH',
          data: { airbnbConfirmationCode: 'HMABCDEFGH' },
        }],
      },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: 'HMABCDEFGH',
      fromAddress: 'jane@x.com',
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result.tier).toBe(1);
    expect(result.id).toBe('b1');
  });

  test('Tier 2: email + window when confirmation code missing', async () => {
    const fs = mockFirestore({
      byField: {
        guestEmail: [{
          id: 'b2',
          _matchValue: 'jane@x.com',
          data: { guestEmail: 'jane@x.com', checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
        }],
      },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: 'jane@x.com',
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result.tier).toBe(2);
    expect(result.id).toBe('b2');
  });

  test('Tier 3: name + window when email tier misses', async () => {
    const fs = mockFirestore({
      byField: {
        guestEmail: [], // no email match
        guestName: [{
          id: 'b3',
          _matchValue: 'jane doe',
          data: { guestName: 'jane doe', checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
        }],
      },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: 'jane@x.com',
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result.tier).toBe(3);
    expect(result.id).toBe('b3');
  });

  test('returns null when all tiers miss', async () => {
    const fs = mockFirestore({ byField: {} });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: 'jane@x.com',
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result).toBeNull();
  });

  test('returns null when only confirmationCode given but no match', async () => {
    const fs = mockFirestore({
      byField: { airbnbConfirmationCode: [] },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: 'HMNOTREAL',
      fromAddress: null,
      guestName: null,
      receivedAt: recv,
    });
    expect(result).toBeNull();
  });

  test('skips tier 2 when fromAddress missing', async () => {
    const fs = mockFirestore({
      byField: {
        guestName: [{
          id: 'b4',
          _matchValue: 'jane doe',
          data: { guestName: 'jane doe', checkInDate: '2026-05-01', checkOutDate: '2026-05-15' },
        }],
      },
    });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: null,
      guestName: 'Jane Doe',
      receivedAt: recv,
    });
    expect(result.tier).toBe(3);
  });

  test('skips tier 3 when guestName missing', async () => {
    const fs = mockFirestore({ byField: { guestEmail: [] } });
    const result = await findMatchingBooking(fs, {
      confirmationCode: null,
      fromAddress: 'jane@x.com',
      guestName: null,
      receivedAt: recv,
    });
    expect(result).toBeNull();
  });
});
