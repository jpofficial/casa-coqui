const { test } = require('node:test');
const assert = require('node:assert');
const { buildThreadKey, isUnmatchedKey } = require('../thread-key');

test('uses bookingCode when present', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: 'ABC123', senderEmail: 'x@y.com' }),
    'ABC123'
  );
  assert.strictEqual(
    buildThreadKey({ bookingCode: '  ABC123  ' }),
    'ABC123'
  );
});

test('falls back to lowercased email when no bookingCode', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: 'Rob@Yahoo.COM' }),
    'email:rob@yahoo.com'
  );
});

test('falls back to lowercased trimmed name when no email', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: null, senderName: '  John Doe ' }),
    'name:john doe'
  );
});

test('returns "unknown" when nothing identifies the sender', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: null, senderEmail: null, senderName: null }),
    'unknown'
  );
});

test('ignores empty strings', () => {
  assert.strictEqual(
    buildThreadKey({ bookingCode: '', senderEmail: '', senderName: 'Jane' }),
    'name:jane'
  );
});

test('isUnmatchedKey detects email: and name: keys', () => {
  assert.strictEqual(isUnmatchedKey('ABC123'), false);
  assert.strictEqual(isUnmatchedKey('email:a@b.com'), true);
  assert.strictEqual(isUnmatchedKey('name:foo'), true);
  assert.strictEqual(isUnmatchedKey('unknown'), true);
  assert.strictEqual(isUnmatchedKey(null), true);
  assert.strictEqual(isUnmatchedKey(undefined), true);
});
