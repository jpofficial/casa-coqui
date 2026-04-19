'use strict';

const { extractConfirmationCodeFromVevent } = require('../vevent-confirmation-code');

describe('extractConfirmationCodeFromVevent', () => {
  test('extracts HM-code from reservation URL in description', () => {
    const vevent = {
      summary: 'Reserved — Shalie Llorens',
      description: 'Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMKQCBA92M',
    };
    expect(extractConfirmationCodeFromVevent(vevent)).toBe('HMKQCBA92M');
  });

  test('extracts HM-code from summary fallback', () => {
    const vevent = {
      summary: 'Reservation HMRJNRRYF5 — Akbar Kamanda',
      description: null,
    };
    expect(extractConfirmationCodeFromVevent(vevent)).toBe('HMRJNRRYF5');
  });

  test('returns null when no HM-code found', () => {
    const vevent = { summary: 'Not available', description: 'blocked dates' };
    expect(extractConfirmationCodeFromVevent(vevent)).toBeNull();
  });

  test('handles missing summary and description', () => {
    expect(extractConfirmationCodeFromVevent({})).toBeNull();
    expect(extractConfirmationCodeFromVevent({ summary: null, description: null })).toBeNull();
  });

  test('prefers description match over summary (more authoritative)', () => {
    const vevent = {
      summary: 'Reservation HMAAAAAAAA',
      description: 'Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMBBBBBBBB',
    };
    expect(extractConfirmationCodeFromVevent(vevent)).toBe('HMBBBBBBBB');
  });
});
