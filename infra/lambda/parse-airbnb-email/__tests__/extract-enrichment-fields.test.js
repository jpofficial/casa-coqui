'use strict';

const { extractEnrichmentFields } = require('../index');

describe('extractEnrichmentFields', () => {
  test('extracts all four fields from a typical Airbnb email', () => {
    const subject = 'New message from Angelina Pascual';
    const body =
      'Angelina Pascual\n' +
      '2 adults\n' +
      'Total paid: $774.40\n' +
      '"Looking forward to our stay!"\n';
    const fields = extractEnrichmentFields(subject, body);
    expect(fields.guestName).toBe('Angelina Pascual');
    expect(fields.guestCount).toBe(2);
    expect(fields.payoutAmount).toBe(774.4);
    expect(fields.guestMessage).toBe('Looking forward to our stay!');
  });

  test('returns nulls when fields are absent', () => {
    const fields = extractEnrichmentFields('Unrelated subject', 'empty body');
    expect(fields.guestName).toBeNull();
    expect(fields.guestCount).toBeNull();
    expect(fields.payoutAmount).toBeNull();
    expect(fields.guestMessage).toBeNull();
  });

  test('payout regex bounded — keyword far from $ does not match', () => {
    // The [^$]{0,200} bound prevents matching when the keyword ("total") and
    // the dollar amount are separated by >200 chars of unrelated text. Without
    // the bound an unrelated "Total" mention could capture a distant $ amount.
    const body =
      'Total summary follows below' +
      'x'.repeat(250) +
      '$774.40';
    const fields = extractEnrichmentFields('subject', body);
    expect(fields.payoutAmount).toBeNull();
  });

  test('guest count matches adults or guests', () => {
    expect(extractEnrichmentFields('s', '7 adults').guestCount).toBe(7);
    expect(extractEnrichmentFields('s', '3 guests').guestCount).toBe(3);
    expect(extractEnrichmentFields('s', '1 adult').guestCount).toBe(1);
  });

  test('guest message requires minimum 20 chars inside quotes', () => {
    const fields = extractEnrichmentFields('s', '"short"');
    expect(fields.guestMessage).toBeNull();
  });
});
