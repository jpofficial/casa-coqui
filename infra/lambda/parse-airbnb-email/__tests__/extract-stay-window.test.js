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
