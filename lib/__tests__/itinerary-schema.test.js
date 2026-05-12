import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ItinerarySchema } from '../itinerary/schema.js';

test('valid itinerary parses', () => {
  const ok = ItinerarySchema.parse({
    plan_id: 'abc123',
    num_days: 3,
    days: [
      { day_num: 1, theme: 'Old San Juan', items: [
        { activity_id: 'X-1', time: 'morning', duration_min: 120 }
      ]}
    ],
  });
  assert.equal(ok.num_days, 3);
});

test('rejects empty items array', () => {
  assert.throws(() => ItinerarySchema.parse({
    plan_id: 'abc', num_days: 1,
    days: [{ day_num: 1, theme: 'x', items: [] }],
  }));
});

test('rejects bad time value', () => {
  assert.throws(() => ItinerarySchema.parse({
    plan_id: 'abc', num_days: 1,
    days: [{ day_num: 1, theme: 'x', items: [
      { activity_id: 'X', time: 'whenever', duration_min: 60 }
    ]}],
  }));
});

test('rejects num_days out of range', () => {
  assert.throws(() => ItinerarySchema.parse({
    plan_id: 'abc', num_days: 20,
    days: [{ day_num: 1, theme: 'x', items: [
      { activity_id: 'X', time: 'morning', duration_min: 60 }
    ]}],
  }));
});
