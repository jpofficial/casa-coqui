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
