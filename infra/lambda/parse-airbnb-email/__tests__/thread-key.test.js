'use strict';

const { buildThreadKey, isUnmatchedKey } = require('../thread-key');

describe('isUnmatchedKey', () => {
  test('treats bookingCode (raw string) as matched', () => {
    expect(isUnmatchedKey('ABC123')).toBe(false);
  });

  test('treats email: prefix as unmatched', () => {
    expect(isUnmatchedKey('email:rob@yahoo.com')).toBe(true);
  });

  test('treats name: prefix as unmatched', () => {
    expect(isUnmatchedKey('name:jane-doe|y:2026')).toBe(true);
  });

  test('treats unknown as unmatched', () => {
    expect(isUnmatchedKey('unknown')).toBe(true);
  });

  test('treats null/empty as unmatched', () => {
    expect(isUnmatchedKey(null)).toBe(true);
    expect(isUnmatchedKey('')).toBe(true);
  });

  test('treats airbnb: prefix as MATCHED (Reply-To token thread)', () => {
    expect(isUnmatchedKey('airbnb:abcdef0123')).toBe(false);
    expect(
      isUnmatchedKey('airbnb:1234567890abcdef1234567890abcdef')
    ).toBe(false);
  });

  // v2 namespace contract (2026-05-11)
  // `booking:<id>` = MATCHED, `guest:<hash>` = UNMATCHED.
  test('treats v2 booking:<id> prefix as MATCHED', () => {
    expect(isUnmatchedKey('booking:abc123')).toBe(false);
    expect(isUnmatchedKey('booking:HMXYZ987')).toBe(false);
  });

  test('treats v2 guest:<hash> prefix as UNMATCHED', () => {
    expect(isUnmatchedKey('guest:abc123')).toBe(true);
    expect(isUnmatchedKey('guest:0123456789abcdef')).toBe(true);
  });
});

describe('buildThreadKey (sanity)', () => {
  test('returns bookingCode unchanged', () => {
    expect(buildThreadKey({ bookingCode: 'XYZ' })).toBe('XYZ');
  });
});
