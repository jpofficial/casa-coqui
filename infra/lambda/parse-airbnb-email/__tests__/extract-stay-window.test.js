'use strict';

/**
 * Tests for extractStayWindowFromSubject + extractStayYearFromSubject.
 *
 * The composite-key threading design (v2) derives a threadKey from
 * (guestName, stayWindow, year). These helpers parse the stayWindow + year
 * out of Airbnb's subject line conventions:
 *   - "RE: Reservation for Casa Coqui #1 ..., May 5 – 13"
 *   - "Inquiry for Acogedora..., Apr 24 – 28, 2026"
 *   - "RE: Reservation for Cozy 4BR..., Apr 30 – May 9"
 *
 * Lowercase + dash-separated tokens. Tolerates en-dash and ascii hyphen.
 */

const {
  extractStayWindowFromSubject,
  extractStayYearFromSubject,
} = require('../index');

describe('extractStayWindowFromSubject', () => {
  test('extracts "may-5-13" from same-month range', () => {
    const subject = 'RE: Reservation for Casa Coqui #1 Next to everything, May 5 – 13';
    expect(extractStayWindowFromSubject(subject)).toBe('may-5-13');
  });

  test('extracts "apr-30-may-9" cross-month range', () => {
    const subject = 'RE: Reservation for Cozy 4BR..., Apr 30 – May 9';
    expect(extractStayWindowFromSubject(subject)).toBe('apr-30-may-9');
  });

  test('extracts "apr-24-28" from inquiry-with-year', () => {
    const subject = 'Inquiry for Acogedora..., Apr 24 – 28, 2026';
    expect(extractStayWindowFromSubject(subject)).toBe('apr-24-28');
  });

  test('extracts "jun-8-14" for single-digit days', () => {
    const subject = 'Reservation for Casa Coqui #1, Jun 8 – 14';
    expect(extractStayWindowFromSubject(subject)).toBe('jun-8-14');
  });

  test('extracts "apr-30-may-9" with "for" preposition', () => {
    const subject = 'Inquiry for Cozy 4BR..., for Apr 30 – May 9';
    expect(extractStayWindowFromSubject(subject)).toBe('apr-30-may-9');
  });

  test('accepts ascii hyphen (-) in place of en-dash', () => {
    const subject = 'RE: Reservation for Casa Coqui #1, May 5 - 13';
    expect(extractStayWindowFromSubject(subject)).toBe('may-5-13');
  });

  test('accepts en-dash (–) variant', () => {
    const subject = 'RE: Reservation for Casa Coqui #1, May 5 – 13';
    expect(extractStayWindowFromSubject(subject)).toBe('may-5-13');
  });

  test('returns null on subject with no date range', () => {
    expect(
      extractStayWindowFromSubject('Payout for booking HMABCXYZ')
    ).toBeNull();
  });

  test('returns null on empty subject', () => {
    expect(extractStayWindowFromSubject('')).toBeNull();
  });

  test('returns null on null subject', () => {
    expect(extractStayWindowFromSubject(null)).toBeNull();
    expect(extractStayWindowFromSubject(undefined)).toBeNull();
  });

  test('tolerant of extra whitespace and produces lowercase dash-separated output', () => {
    const subject = 'RE: Reservation for Casa Coqui #1,   May   5   –   13   ';
    expect(extractStayWindowFromSubject(subject)).toBe('may-5-13');
  });

  test('strips trailing year tokens cleanly (does not contaminate window)', () => {
    const subject = 'Inquiry for Place, Apr 24 – 28, 2026';
    expect(extractStayWindowFromSubject(subject)).toBe('apr-24-28');
  });

  // Month canonicalization — Airbnb may emit "Sept 5 – 13" or "September 5 – 13"
  // for the same conversation. We canonicalize every month token to its 3-letter
  // form so threadKeys do not split on cosmetic variations.
  test('canonicalizes "Sept" → "sep" (same window as "Sep")', () => {
    expect(extractStayWindowFromSubject('Reservation for X, Sept 5 – 13'))
      .toBe(extractStayWindowFromSubject('Reservation for X, Sep 5 – 13'));
  });

  test('canonicalizes "September" → "sep" (same window as "Sep")', () => {
    expect(extractStayWindowFromSubject('Reservation for X, September 5 – 13'))
      .toBe(extractStayWindowFromSubject('Reservation for X, Sep 5 – 13'));
  });

  test('canonicalizes full month names ("January" → "jan")', () => {
    expect(extractStayWindowFromSubject('Reservation for X, January 5 – 9'))
      .toBe('jan-5-9');
    expect(extractStayWindowFromSubject('Reservation for X, December 28 – 30'))
      .toBe('dec-28-30');
  });

  test('canonicalizes month2 in cross-month windows', () => {
    expect(extractStayWindowFromSubject('Reservation, Apr 30 – September 9'))
      .toBe(extractStayWindowFromSubject('Reservation, Apr 30 – Sep 9'));
  });

  // Day bounds — only 01-31 are valid calendar days. Reject obvious garbage.
  test('rejects day "0" (zero is not a valid day)', () => {
    expect(extractStayWindowFromSubject('Reservation, May 0 – 13')).toBeNull();
  });

  test('rejects day "99" (out of range)', () => {
    expect(extractStayWindowFromSubject('Reservation, May 5 – 99')).toBeNull();
  });

  test('accepts day 31 (upper bound)', () => {
    expect(extractStayWindowFromSubject('Reservation, May 5 – 31')).toBe('may-5-31');
  });

  test('accepts day 01 (zero-padded lower bound)', () => {
    expect(extractStayWindowFromSubject('Reservation, May 01 – 13')).toBe('may-01-13');
  });
});

describe('extractStayYearFromSubject', () => {
  test('prefers explicit year in subject when present', () => {
    const year = extractStayYearFromSubject(
      'Inquiry for Place, Apr 24 – 28, 2026',
      new Date('2026-04-01T00:00:00Z')
    );
    expect(year).toBe('2026');
  });

  test('prefers explicit year even when it differs from receivedAt year', () => {
    const year = extractStayYearFromSubject(
      'Reservation for X, Jan 5 – 9, 2027',
      new Date('2026-12-30T00:00:00Z')
    );
    expect(year).toBe('2027');
  });

  test('falls back to receivedAt year when no explicit year', () => {
    const year = extractStayYearFromSubject(
      'RE: Reservation for Casa Coqui #1, May 5 – 13',
      new Date('2026-05-01T00:00:00Z')
    );
    expect(year).toBe('2026');
  });

  test('handles December receivedAt + January subject → next year', () => {
    const year = extractStayYearFromSubject(
      'Reservation for X, Jan 5 – 9',
      new Date('2026-12-30T00:00:00Z')
    );
    expect(year).toBe('2027');
  });

  test('handles January receivedAt + December subject → previous year', () => {
    const year = extractStayYearFromSubject(
      'Reservation for X, Dec 28 – 30',
      new Date('2027-01-02T00:00:00Z')
    );
    expect(year).toBe('2026');
  });

  test('accepts ISO string for receivedAt', () => {
    const year = extractStayYearFromSubject(
      'RE: Reservation for X, May 5 – 13',
      '2026-05-01T00:00:00Z'
    );
    expect(year).toBe('2026');
  });

  test('returns a 4-digit string', () => {
    const year = extractStayYearFromSubject(
      'RE: Reservation for X, May 5 – 13',
      new Date('2026-05-01T00:00:00Z')
    );
    expect(year).toMatch(/^\d{4}$/);
  });
});
