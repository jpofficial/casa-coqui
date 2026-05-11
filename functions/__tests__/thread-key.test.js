'use strict';

/**
 * Functions copy of the thread-key namespace contract. Must stay in sync with
 *   - lib/__tests__/thread-key.test.js
 *   - infra/lambda/parse-airbnb-email/__tests__/thread-key.test.js
 *
 * Uses node:test (functions/ does not currently have jest installed locally;
 * this style runs via `node --test functions/__tests__/thread-key.test.js`).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { buildThreadKey, isUnmatchedKey } = require('../lib/thread-key');

test('buildThreadKey: bookingCode passthrough', () => {
  assert.strictEqual(buildThreadKey({ bookingCode: 'XYZ' }), 'XYZ');
});

test('isUnmatchedKey: bookingCode (raw) is MATCHED', () => {
  assert.strictEqual(isUnmatchedKey('ABC123'), false);
});

test('isUnmatchedKey: email: prefix is UNMATCHED', () => {
  assert.strictEqual(isUnmatchedKey('email:rob@yahoo.com'), true);
});

test('isUnmatchedKey: name: prefix is UNMATCHED', () => {
  assert.strictEqual(isUnmatchedKey('name:jane-doe|y:2026'), true);
});

test('isUnmatchedKey: unknown is UNMATCHED', () => {
  assert.strictEqual(isUnmatchedKey('unknown'), true);
});

test('isUnmatchedKey: null/empty is UNMATCHED', () => {
  assert.strictEqual(isUnmatchedKey(null), true);
  assert.strictEqual(isUnmatchedKey(''), true);
  assert.strictEqual(isUnmatchedKey(undefined), true);
});

// v2 namespace contract (2026-05-11)
test('isUnmatchedKey: v2 booking:<id> is MATCHED', () => {
  assert.strictEqual(isUnmatchedKey('booking:abc123'), false);
});

test('isUnmatchedKey: v2 guest:<hash> is UNMATCHED', () => {
  assert.strictEqual(isUnmatchedKey('guest:abc123'), true);
});
