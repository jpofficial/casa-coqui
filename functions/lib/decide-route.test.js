'use strict';

const { decideRoute, hashMessageId } = require('./decide-route');

describe('hashMessageId', () => {
  test('deterministic — same input always yields same bucket', () => {
    expect(hashMessageId('abc123')).toBe(hashMessageId('abc123'));
  });

  test('produces a value in [0, 99]', () => {
    for (const id of ['a', 'longer-message-id', '12345', '🦊']) {
      const v = hashMessageId(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });
});

describe('decideRoute', () => {
  // Spec AC #2 enumerates these five cases.

  test('(a) mode: firebase always returns engine: firebase + reason: firebase-explicit', () => {
    expect(decideRoute({ messageId: 'any', flag: { mode: 'firebase', rollout_pct: 50 } }))
      .toEqual({ engine: 'firebase', reason: 'firebase-explicit' });
  });

  test('(b) mode: aws-sfn AND hash < rollout_pct → engine: aws-sfn + reason: rollout-routed', () => {
    const mid = 'msg-routed-fixture';
    const bucket = hashMessageId(mid);
    const flag = { mode: 'aws-sfn', rollout_pct: bucket + 1 };
    expect(decideRoute({ messageId: mid, flag }))
      .toEqual({ engine: 'aws-sfn', reason: 'rollout-routed' });
  });

  test('(c) mode: aws-sfn AND hash >= rollout_pct → engine: firebase + reason: rollout-gated', () => {
    const mid = 'msg-gated-fixture';
    const bucket = hashMessageId(mid);
    const flag = { mode: 'aws-sfn', rollout_pct: bucket };
    expect(decideRoute({ messageId: mid, flag }))
      .toEqual({ engine: 'firebase', reason: 'rollout-gated' });
  });

  test('(d) mode: shadow → engine: firebase + reason: shadow-stub (warn-log expected by caller)', () => {
    expect(decideRoute({ messageId: 'any', flag: { mode: 'shadow', rollout_pct: 100 } }))
      .toEqual({ engine: 'firebase', reason: 'shadow-stub' });
  });

  test('(e) malformed flag (missing mode) → engine: firebase + reason: legacy-fallback', () => {
    expect(decideRoute({ messageId: 'any', flag: {} }))
      .toEqual({ engine: 'firebase', reason: 'legacy-fallback' });
    expect(decideRoute({ messageId: 'any', flag: null }))
      .toEqual({ engine: 'firebase', reason: 'legacy-fallback' });
    expect(decideRoute({ messageId: 'any', flag: undefined }))
      .toEqual({ engine: 'firebase', reason: 'legacy-fallback' });
  });

  test('rollout_pct: 0 → never routes to SFN even at mode: aws-sfn', () => {
    for (const mid of ['a', 'b', 'c', 'long-id-4567']) {
      expect(decideRoute({ messageId: mid, flag: { mode: 'aws-sfn', rollout_pct: 0 } }))
        .toEqual({ engine: 'firebase', reason: 'rollout-gated' });
    }
  });

  test('rollout_pct: 100 → routes all messages to SFN at mode: aws-sfn', () => {
    for (const mid of ['a', 'b', 'c', 'long-id-4567']) {
      expect(decideRoute({ messageId: mid, flag: { mode: 'aws-sfn', rollout_pct: 100 } }))
        .toEqual({ engine: 'aws-sfn', reason: 'rollout-routed' });
    }
  });
});
