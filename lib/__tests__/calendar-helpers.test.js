import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWarningList } from '../calendar-helpers.js';

test('buildWarningList flags checkout day with no cleaning job', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra', 'Coqui Cielo'], '2026-04-01', '2026-04-30');

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'missing_cleaning');
  assert.equal(warnings[0].dateStr, '2026-04-15');
  assert.equal(warnings[0].unit, 'Coqui Tierra');
  assert.equal(warnings[0].bookingId, 'b1');
  assert.match(warnings[0].fixHref, /\/admin\/cleaning\?new=1/);
  assert.match(warnings[0].fixHref, /unit=Coqui%20Tierra/);
  assert.match(warnings[0].fixHref, /date=2026-04-15/);
});

test('buildWarningList ignores cancelled bookings', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'cancelled' },
  ];
  const warnings = buildWarningList(bookings, [], ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 0);
});

test('buildWarningList ignores checkouts outside window', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-01-10', checkOutDate: '2026-01-15', status: 'active' },
  ];
  const warnings = buildWarningList(bookings, [], ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 0);
});

test('buildWarningList does not flag when cleaning exists on that unit+date', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', bookingId: 'b1', unit: 'Coqui Tierra', scheduledDate: '2026-04-15', status: 'scheduled' },
  ];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 0);
});

test('buildWarningList ignores cleaning jobs with terminal status', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', bookingId: 'b1', unit: 'Coqui Tierra', scheduledDate: '2026-04-15', status: 'cancelled' },
  ];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'missing_cleaning');
});

test('buildWarningList flags date mismatch between booking checkout and cleaning scheduledDate', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', bookingId: 'b1', unit: 'Coqui Tierra', scheduledDate: '2026-04-16', status: 'scheduled' },
  ];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'date_mismatch');
  assert.equal(warnings[0].dateStr, '2026-04-16');
  assert.equal(warnings[0].unit, 'Coqui Tierra');
  assert.equal(warnings[0].bookingId, 'b1');
  assert.equal(warnings[0].cleaningJobId, 'j1');
});

test('buildWarningList does not flag date mismatch when cleaning has manualOverride', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', bookingId: 'b1', unit: 'Coqui Tierra', scheduledDate: '2026-04-16', status: 'scheduled', manualOverride: true },
  ];
  const warnings = buildWarningList(bookings, cleaningJobs, ['Coqui Tierra'], '2026-04-01', '2026-04-30');
  // manualOverride suppresses date-mismatch; BUT the booking checkout (Apr 15) still has no cleaning → missing_cleaning
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'missing_cleaning');
  assert.equal(warnings[0].dateStr, '2026-04-15');
});
