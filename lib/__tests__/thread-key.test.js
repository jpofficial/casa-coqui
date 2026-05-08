const { test } = require('node:test');
const assert = require('node:assert');
const { buildThreadKey, isUnmatchedKey } = require('../thread-key');

const FIXED_DATE = new Date('2026-05-07T12:00:00Z');

test('uses bookingCode when present', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: 'ABC123', senderEmail: 'x@y.com', receivedAt: FIXED_DATE }),
    'ABC123'
  );
  assert.strictEqual(
    buildThreadKey({ bookingCode: '  ABC123  ', receivedAt: FIXED_DATE }),
    'ABC123'
  );
});

test('falls back to lowercased email when no bookingCode (non-airbnb)', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: 'Rob@Yahoo.COM', receivedAt: FIXED_DATE }),
    'email:rob@yahoo.com'
  );
});

test('SKIPS email tier when address is an airbnb forwarder', () => {
  // Falls through to name + year bucket
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderEmail: 'express@airbnb.com',
      senderName: 'Jane Doe',
      receivedAt: FIXED_DATE,
    }),
    'name:jane-doe|y:2026'
  );
});

test('SKIPS email tier for any @airbnb.com address', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderEmail: 'noreply@airbnb.com',
      senderName: 'John Smith',
      receivedAt: FIXED_DATE,
    }),
    'name:john-smith|y:2026'
  );
});

test('uses name + year bucket when no email', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderEmail: null,
      senderName: '  John Doe ',
      receivedAt: FIXED_DATE,
    }),
    'name:john-doe|y:2026'
  );
});

test('preserves accented characters in safeName (Unicode-aware)', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: 'José Pérez',
      receivedAt: FIXED_DATE,
    }),
    'name:josé-pérez|y:2026'
  );
});

test('handles apostrophes and hyphens in names', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: "O'Brien-Smith",
      receivedAt: FIXED_DATE,
    }),
    'name:o-brien-smith|y:2026'
  );
});

test('same person across calendar months produces SAME key (annual bucket)', () => {
  const apr30 = new Date('2026-04-30T23:00:00Z');
  const may2 = new Date('2026-05-02T08:00:00Z');
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderName: 'Jane Doe', receivedAt: apr30 }),
    buildThreadKey({ bookingCode: null, senderName: 'Jane Doe', receivedAt: may2 })
  );
});

test('same person across year boundary produces DIFFERENT keys', () => {
  const dec31 = new Date('2025-12-31T23:00:00Z');
  const jan1 = new Date('2026-01-01T01:00:00Z');
  const k1 = buildThreadKey({ bookingCode: null, senderName: 'Jane Doe', receivedAt: dec31 });
  const k2 = buildThreadKey({ bookingCode: null, senderName: 'Jane Doe', receivedAt: jan1 });
  assert.notStrictEqual(k1, k2);
  assert.strictEqual(k1, 'name:jane-doe|y:2025');
  assert.strictEqual(k2, 'name:jane-doe|y:2026');
});

test('defaults to current year when receivedAt missing', () => {
  const result = buildThreadKey({ bookingCode: null, senderName: 'Jane Doe' });
  const currentYear = new Date().getUTCFullYear();
  assert.strictEqual(result, `name:jane-doe|y:${currentYear}`);
});

test('accepts receivedAt as ISO string or millis', () => {
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: 'Jane',
      receivedAt: '2026-05-07T12:00:00Z',
    }),
    'name:jane|y:2026'
  );
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: 'Jane',
      receivedAt: FIXED_DATE.getTime(),
    }),
    'name:jane|y:2026'
  );
});

test('returns "unknown" when nothing identifies the sender', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: null, senderName: null, receivedAt: FIXED_DATE }),
    'unknown'
  );
});

test('returns "unknown" when senderName is only non-letter chars', () => {
  // safeName ends up empty after strip → fall through
  assert.strictEqual(
    buildThreadKey({
      bookingCode: null,
      senderName: '???',
      receivedAt: FIXED_DATE,
    }),
    'unknown'
  );
});

test('ignores empty strings', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: '', senderEmail: '', senderName: 'Jane', receivedAt: FIXED_DATE }),
    'name:jane|y:2026'
  );
});

test('isUnmatchedKey detects email:, name:, and unknown keys', () => {
  assert.strictEqual(isUnmatchedKey('ABC123'), false);
  assert.strictEqual(isUnmatchedKey('email:a@b.com'), true);
  assert.strictEqual(isUnmatchedKey('name:foo|y:2026'), true);
  assert.strictEqual(isUnmatchedKey('name:foo'), true); // legacy format still matches
  assert.strictEqual(isUnmatchedKey('unknown'), true);
  assert.strictEqual(isUnmatchedKey(null), true);
  assert.strictEqual(isUnmatchedKey(undefined), true);
});
