'use strict';

const ical = require('node-ical');
const { veventDateToYMD } = require('../lib/ics-date');

// Build a minimal iCalendar string with a single VEVENT.
// Airbnb's feed uses DATE-only values; we also exercise DATE-TIME for
// safety against future feed format changes.
function buildIcs(veventBody) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//EN',
    'BEGIN:VEVENT',
    'UID:test-uid@example.com',
    'SUMMARY:Reserved',
    veventBody,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function parseFirstEvent(ics) {
  const parsed = ical.sync.parseICS(ics);
  for (const key of Object.keys(parsed)) {
    if (parsed[key].type === 'VEVENT') return parsed[key];
  }
  throw new Error('no VEVENT found in fixture');
}

describe('veventDateToYMD', () => {
  test('DATE-only DTSTART returns the exact calendar day (Airbnb primary case)', () => {
    const ics = buildIcs('DTSTART;VALUE=DATE:20260415\r\nDTEND;VALUE=DATE:20260420');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start, { dateOnly: event.datetype === 'date' })).toBe('2026-04-15');
  });

  test('DATE-only DTEND returns the exact calendar day (exclusive per iCal spec)', () => {
    const ics = buildIcs('DTSTART;VALUE=DATE:20260415\r\nDTEND;VALUE=DATE:20260420');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.end, { dateOnly: event.datetype === 'date' })).toBe('2026-04-20');
  });

  test('DATE-only at month boundary', () => {
    const ics = buildIcs('DTSTART;VALUE=DATE:20260430\r\nDTEND;VALUE=DATE:20260501');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start, { dateOnly: event.datetype === 'date' })).toBe('2026-04-30');
    expect(veventDateToYMD(event.end, { dateOnly: event.datetype === 'date' })).toBe('2026-05-01');
  });

  test('DATE-only at year boundary', () => {
    const ics = buildIcs('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start, { dateOnly: event.datetype === 'date' })).toBe('2026-12-31');
    expect(veventDateToYMD(event.end, { dateOnly: event.datetype === 'date' })).toBe('2027-01-01');
  });

  test('DATE-TIME with TZID=America/Puerto_Rico resolves to local calendar day', () => {
    const ics = buildIcs(
      'DTSTART;TZID=America/Puerto_Rico:20260415T160000\r\n' +
      'DTEND;TZID=America/Puerto_Rico:20260420T110000'
    );
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start)).toBe('2026-04-15');
    expect(veventDateToYMD(event.end)).toBe('2026-04-20');
  });

  test('DATE-TIME in UTC returns the Puerto Rico calendar day', () => {
    // 2026-04-15T02:00:00Z is 2026-04-14T22:00:00 in America/Puerto_Rico (UTC-4).
    // The parser must return the Puerto Rico local day, not the UTC day.
    const ics = buildIcs('DTSTART:20260415T020000Z\r\nDTEND:20260415T030000Z');
    const event = parseFirstEvent(ics);
    expect(veventDateToYMD(event.start)).toBe('2026-04-14');
  });

  test('null and invalid inputs return null without throwing', () => {
    expect(veventDateToYMD(null)).toBeNull();
    expect(veventDateToYMD(undefined)).toBeNull();
    expect(veventDateToYMD(new Date('not a date'))).toBeNull();
  });
});
