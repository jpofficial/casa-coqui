'use strict';

/**
 * Tests for resolveGuestNameWithLogging — the helper extracted from the
 * Lambda handler that resolves the guest name across strategies (subject →
 * HTML body → plaintext body → sentinel) AND emits structured warn-logs
 * ONLY for the fallback paths that were actually attempted and failed.
 *
 * Pre-Improvement-4 behavior: when bodyName was null, BOTH 'html' AND
 * 'plaintext' warns fired unconditionally — even when one of those paths
 * was never attempted (e.g. empty HTML, only plaintext available).
 *
 * Post-Improvement-4 behavior:
 *   - subject hit                                  → no warns (success)
 *   - body succeeds via html                       → ONE warn: stage='subject'
 *   - body succeeds via plaintext, html attempted  → TWO warns: 'subject', 'html'
 *   - body succeeds via plaintext, html missing    → ONE warn: 'subject'
 *   - all fail, html present, text present         → FOUR warns: 'subject','html','plaintext','sentinel'
 *   - all fail, html missing, text present         → THREE warns: 'subject','plaintext','sentinel'
 *   - all fail, html present, text missing         → THREE warns: 'subject','html','sentinel'
 *   - all fail, both missing                       → TWO warns: 'subject','sentinel'
 */

const { resolveGuestNameWithLogging } = require('../index');

function captureWarns(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => warns.push(args.length === 1 ? args[0] : args);
  try {
    const result = fn();
    return { result, warns: warns.map((w) => (typeof w === 'string' ? safeJsonParse(w) : w)) };
  } finally {
    console.warn = orig;
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

const SUBJECT_WITH_NAME = 'New message from Jane Doe';
const SUBJECT_NO_NAME = 'Reservation for Casa Coqui #1, May 5 - 13';

const HTML_WITH_NAME = '<img alt="Jane"><h2>Jane</h2><p>Booker</p>';
const HTML_NO_MATCH = '<p>Hello world.</p>';
const TEXT_WITH_NAME = '   JANE\n   Booker\n   ...';
const TEXT_NO_MATCH = 'Hello world.\n';

const ENV = { sesMessageId: 'ses-1', objectKey: 'k/1', fromDisplayName: 'Airbnb' };

describe('resolveGuestNameWithLogging — emission rules', () => {
  test('subject hit → name from subject, NO warns', () => {
    const { result, warns } = captureWarns(() =>
      resolveGuestNameWithLogging({
        subject: SUBJECT_WITH_NAME,
        html: HTML_WITH_NAME,
        text: TEXT_WITH_NAME,
        ...ENV,
      })
    );
    expect(result).toEqual({ guestName: 'Jane Doe', source: 'subject' });
    expect(warns).toHaveLength(0);
  });

  test('body succeeds via html → only `subject` warn fires', () => {
    const { result, warns } = captureWarns(() =>
      resolveGuestNameWithLogging({
        subject: SUBJECT_NO_NAME,
        html: HTML_WITH_NAME,
        text: '',
        ...ENV,
      })
    );
    expect(result).toEqual({ guestName: 'Jane', source: 'html' });
    expect(warns.map((w) => w.stage)).toEqual(['subject']);
  });

  test('body succeeds via plaintext, html attempted but missed → `subject` + `html` warns', () => {
    const { result, warns } = captureWarns(() =>
      resolveGuestNameWithLogging({
        subject: SUBJECT_NO_NAME,
        html: HTML_NO_MATCH,
        text: TEXT_WITH_NAME,
        ...ENV,
      })
    );
    expect(result).toEqual({ guestName: 'Jane', source: 'plaintext' });
    expect(warns.map((w) => w.stage)).toEqual(['subject', 'html']);
  });

  test('body succeeds via plaintext, html NEVER attempted → only `subject` warn', () => {
    const { result, warns } = captureWarns(() =>
      resolveGuestNameWithLogging({
        subject: SUBJECT_NO_NAME,
        html: '', // not attempted
        text: TEXT_WITH_NAME,
        ...ENV,
      })
    );
    expect(result).toEqual({ guestName: 'Jane', source: 'plaintext' });
    expect(warns.map((w) => w.stage)).toEqual(['subject']);
  });

  test('all fail, both html + text present → `subject` + `html` + `plaintext` + `sentinel`', () => {
    const { result, warns } = captureWarns(() =>
      resolveGuestNameWithLogging({
        subject: SUBJECT_NO_NAME,
        html: HTML_NO_MATCH,
        text: TEXT_NO_MATCH,
        ...ENV,
      })
    );
    expect(result).toEqual({ guestName: 'Unknown sender', source: 'sentinel' });
    expect(warns.map((w) => w.stage)).toEqual(['subject', 'html', 'plaintext', 'sentinel']);
  });

  test('all fail, html missing → `subject` + `plaintext` + `sentinel` (NO `html` warn)', () => {
    const { result, warns } = captureWarns(() =>
      resolveGuestNameWithLogging({
        subject: SUBJECT_NO_NAME,
        html: null, // never attempted
        text: TEXT_NO_MATCH,
        ...ENV,
      })
    );
    expect(result).toEqual({ guestName: 'Unknown sender', source: 'sentinel' });
    expect(warns.map((w) => w.stage)).toEqual(['subject', 'plaintext', 'sentinel']);
  });

  test('all fail, plaintext missing → `subject` + `html` + `sentinel` (NO `plaintext` warn)', () => {
    const { result, warns } = captureWarns(() =>
      resolveGuestNameWithLogging({
        subject: SUBJECT_NO_NAME,
        html: HTML_NO_MATCH,
        text: '', // never attempted
        ...ENV,
      })
    );
    expect(result).toEqual({ guestName: 'Unknown sender', source: 'sentinel' });
    expect(warns.map((w) => w.stage)).toEqual(['subject', 'html', 'sentinel']);
  });

  test('all fail, both html + text missing → `subject` + `sentinel` only', () => {
    const { result, warns } = captureWarns(() =>
      resolveGuestNameWithLogging({
        subject: SUBJECT_NO_NAME,
        html: null,
        text: null,
        ...ENV,
      })
    );
    expect(result).toEqual({ guestName: 'Unknown sender', source: 'sentinel' });
    expect(warns.map((w) => w.stage)).toEqual(['subject', 'sentinel']);
  });

  test('warn payload includes sesMessageId, objectKey, fromDisplayName', () => {
    const { warns } = captureWarns(() =>
      resolveGuestNameWithLogging({
        subject: SUBJECT_NO_NAME,
        html: HTML_NO_MATCH,
        text: TEXT_NO_MATCH,
        sesMessageId: 'ses-XYZ',
        objectKey: 'inbox/abc.eml',
        fromDisplayName: 'Airbnb',
      })
    );
    for (const w of warns) {
      expect(w).toMatchObject({
        event: 'guest_name_fallback',
        sesMessageId: 'ses-XYZ',
        objectKey: 'inbox/abc.eml',
        fromDisplayName: 'Airbnb',
      });
    }
  });
});
