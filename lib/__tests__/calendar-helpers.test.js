import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWarningList, buildAgendaForWindow } from '../calendar-helpers.js';

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

test('buildAgendaForWindow emits check-in + check-out events per booking', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-15', checkOutDate: '2026-04-18', guestName: 'Ana', source: 'airbnb', status: 'active' },
  ];
  const days = buildAgendaForWindow(bookings, [], '2026-04-15', 14);
  const dates = days.map((d) => d.dateStr);
  assert.ok(dates.includes('2026-04-15'));
  assert.ok(dates.includes('2026-04-18'));

  const apr15 = days.find((d) => d.dateStr === '2026-04-15');
  assert.equal(apr15.events.length, 1);
  assert.equal(apr15.events[0].kind, 'check_in');
  assert.equal(apr15.events[0].bookingId, 'b1');
  assert.equal(apr15.events[0].guestName, 'Ana');
  assert.equal(apr15.events[0].unit, 'Coqui Tierra');
  assert.equal(apr15.events[0].source, 'airbnb');

  const apr18 = days.find((d) => d.dateStr === '2026-04-18');
  assert.equal(apr18.events[0].kind, 'check_out');
});

test('buildAgendaForWindow emits cleaning events with status label', () => {
  const cleaningJobs = [
    { id: 'j1', unit: 'Coqui Cielo', scheduledDate: '2026-04-16', status: 'scheduled', assigneeName: 'Luisa' },
  ];
  const days = buildAgendaForWindow([], cleaningJobs, '2026-04-15', 14);
  const apr16 = days.find((d) => d.dateStr === '2026-04-16');
  assert.equal(apr16.events.length, 1);
  assert.equal(apr16.events[0].kind, 'cleaning');
  assert.equal(apr16.events[0].cleaningJobId, 'j1');
  assert.equal(apr16.events[0].unit, 'Coqui Cielo');
  assert.equal(apr16.events[0].assigneeName, 'Luisa');
});

test('buildAgendaForWindow excludes mid-stay nights', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-15', checkOutDate: '2026-04-20', guestName: 'Ana', status: 'active' },
  ];
  const days = buildAgendaForWindow(bookings, [], '2026-04-15', 14);
  const dates = days.map((d) => d.dateStr);
  assert.deepEqual(dates.sort(), ['2026-04-15', '2026-04-20']);
});

test('buildAgendaForWindow excludes events outside window', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-05-10', checkOutDate: '2026-05-12', guestName: 'Ana', status: 'active' },
  ];
  const days = buildAgendaForWindow(bookings, [], '2026-04-15', 14);
  assert.equal(days.length, 0);
});

test('buildAgendaForWindow excludes cancelled bookings and terminal cleanings', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-15', checkOutDate: '2026-04-18', guestName: 'Ana', status: 'cancelled' },
  ];
  const cleaningJobs = [
    { id: 'j1', unit: 'Coqui Cielo', scheduledDate: '2026-04-16', status: 'cancelled' },
  ];
  const days = buildAgendaForWindow(bookings, cleaningJobs, '2026-04-15', 14);
  assert.equal(days.length, 0);
});

test('buildAgendaForWindow sorts events within a day: check-in, check-out, cleaning', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-15', checkOutDate: '2026-04-20', guestName: 'CIguest', status: 'active' },
    { id: 'b2', unit: 'Coqui Cielo', checkInDate: '2026-04-10', checkOutDate: '2026-04-15', guestName: 'COguest', status: 'active' },
  ];
  const cleaningJobs = [
    { id: 'j1', unit: 'Coqui Cielo', scheduledDate: '2026-04-15', status: 'scheduled' },
  ];
  const days = buildAgendaForWindow(bookings, cleaningJobs, '2026-04-15', 14);
  const apr15 = days.find((d) => d.dateStr === '2026-04-15');
  assert.equal(apr15.events.length, 3);
  assert.equal(apr15.events[0].kind, 'check_in');
  assert.equal(apr15.events[1].kind, 'check_out');
  assert.equal(apr15.events[2].kind, 'cleaning');
});

test('buildAgendaForWindow returns days in ascending date order', () => {
  const bookings = [
    { id: 'b1', unit: 'Coqui Tierra', checkInDate: '2026-04-20', checkOutDate: '2026-04-22', guestName: 'B', status: 'active' },
    { id: 'b2', unit: 'Coqui Cielo', checkInDate: '2026-04-16', checkOutDate: '2026-04-18', guestName: 'A', status: 'active' },
  ];
  const days = buildAgendaForWindow(bookings, [], '2026-04-15', 14);
  const dates = days.map((d) => d.dateStr);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted);
});
