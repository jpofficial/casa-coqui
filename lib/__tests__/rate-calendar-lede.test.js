import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRateLede } from '../pricing-ai.js';

// Mock Anthropic client via a global override.
function mockAnthropic(responseText) {
  const calls = [];
  globalThis.__TEST_ANTHROPIC_CLIENT = {
    messages: {
      create: async (args) => {
        calls.push(args);
        return { content: [{ type: 'text', text: responseText }], stop_reason: 'end_turn' };
      },
    },
  };
  return calls;
}

test('generateRateLede returns a short string built from the mocked response', async () => {
  const calls = mockAnthropic('Friday is a hot night. 72% of comps are already booked and the rest are at $220 median.');
  const rec = {
    unit_id: 'unit-a',
    check_date: '2026-04-10',
    rec_nightly_rate: 215,
    verdict: 'raise',
    confidence: 72,
    demand_signal: 'tight',
    tcpn_2n: 220,
    day_type: 'weekend',
  };
  const comps = { total: 18, booked: 13, pct: 72 };
  const lede = await generateRateLede({ rec, comps });
  assert.match(lede, /hot night/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].messages[0].content.includes('2026-04-10'));
  delete globalThis.__TEST_ANTHROPIC_CLIENT;
});

test('generateRateLede falls back to a deterministic template if the model throws', async () => {
  globalThis.__TEST_ANTHROPIC_CLIENT = {
    messages: { create: async () => { throw new Error('rate limited'); } },
  };
  const rec = {
    unit_id: 'unit-a',
    check_date: '2026-04-10',
    rec_nightly_rate: 215,
    verdict: 'raise',
    confidence: 72,
    demand_signal: 'tight',
    tcpn_2n: 220,
    day_type: 'weekend',
  };
  const comps = { total: 18, booked: 13, pct: 72 };
  const lede = await generateRateLede({ rec, comps });
  assert.ok(lede.length > 0);
  assert.match(lede, /tight|booked|weekend/i);
  delete globalThis.__TEST_ANTHROPIC_CLIENT;
});
