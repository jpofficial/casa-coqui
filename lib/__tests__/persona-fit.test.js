import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casaCoquiFits } from '../itinerary/persona-fit.js';

test('couple on 5-day trip — fits', () => {
  assert.equal(casaCoquiFits({ traveler_type: 'couple', num_days: 5 }).fit, true);
});

test('family on 7-day trip — fits', () => {
  assert.equal(casaCoquiFits({ traveler_type: 'family', num_days: 7 }).fit, true);
});

test('solo traveler — does NOT fit', () => {
  const r = casaCoquiFits({ traveler_type: 'solo', num_days: 5 });
  assert.equal(r.fit, false);
  assert.equal(r.reason, 'solo_overprovisioned');
});

test('1-day trip — does NOT fit', () => {
  assert.equal(casaCoquiFits({ traveler_type: 'couple', num_days: 1 }).fit, false);
});

test('15-day trip — does NOT fit', () => {
  assert.equal(casaCoquiFits({ traveler_type: 'couple', num_days: 15 }).fit, false);
});

test('derives num_days from days array if missing', () => {
  const r = casaCoquiFits({
    traveler_type: 'couple',
    days: [{ day_num: 1 }, { day_num: 2 }, { day_num: 3 }],
  });
  assert.equal(r.fit, true);
});
