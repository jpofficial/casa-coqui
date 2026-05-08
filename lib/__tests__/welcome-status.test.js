const { test } = require('node:test');
const assert = require('node:assert');
const {
  WELCOME_STATUSES,
  isActionable,
  computeDefaultSnoozeIso,
  isStuckPending,
} = require('../welcome-status');

test('exports the full status enum', () => {
  assert.deepStrictEqual(
    Object.keys(WELCOME_STATUSES).sort(),
    ['ERROR', 'PENDING', 'READY', 'SENT', 'SKIPPED', 'SNOOZED']
  );
});

test('isActionable returns true for ready only', () => {
  assert.strictEqual(isActionable('ready'), true);
  assert.strictEqual(isActionable('pending'), false);
  assert.strictEqual(isActionable('snoozed'), false);
  assert.strictEqual(isActionable('sent'), false);
  assert.strictEqual(isActionable('skipped'), false);
  assert.strictEqual(isActionable('error'), false);
});

test('computeDefaultSnoozeIso returns 9am local on day before check-in', () => {
  const checkIn = '2026-07-05'; // Jul 5 2026
  const iso = computeDefaultSnoozeIso(checkIn);
  const d = new Date(iso);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 6); // July (0-indexed)
  assert.strictEqual(d.getDate(), 4);  // day before
  assert.strictEqual(d.getHours(), 9);
  assert.strictEqual(d.getMinutes(), 0);
});

test('computeDefaultSnoozeIso returns null for invalid input', () => {
  assert.strictEqual(computeDefaultSnoozeIso(null), null);
  assert.strictEqual(computeDefaultSnoozeIso(''), null);
  assert.strictEqual(computeDefaultSnoozeIso('not-a-date'), null);
});

test('isStuckPending detects pending older than 10 min', () => {
  const tenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.strictEqual(isStuckPending('pending', tenMinAgo), true);
  assert.strictEqual(isStuckPending('pending', fiveMinAgo), false);
  assert.strictEqual(isStuckPending('ready', tenMinAgo), false);
});
