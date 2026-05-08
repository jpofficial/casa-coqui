'use strict';

const {
  createWithBackoff,
  isRetryable,
  backoffDelayMs,
  MAX_ATTEMPTS,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
} = require('../anthropic-with-backoff');

// Silence console during tests
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

// Build a fake Anthropic client whose messages.create() can be programmed to
// fail or succeed in sequence.
function makeMockClient(scriptedOutcomes) {
  const calls = [];
  let i = 0;
  return {
    messages: {
      create: jest.fn(async (params) => {
        calls.push(params);
        const outcome = scriptedOutcomes[i++];
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }),
    },
    _calls: () => calls,
  };
}

function makeError(status, message = 'fail') {
  const err = new Error(message);
  err.status = status;
  return err;
}

describe('isRetryable', () => {
  test('429 → retryable', () => {
    expect(isRetryable(makeError(429))).toBe(true);
  });

  test('529 (Anthropic overloaded) → retryable', () => {
    expect(isRetryable(makeError(529))).toBe(true);
  });

  test('500/502/503/504 → retryable', () => {
    expect(isRetryable(makeError(500))).toBe(true);
    expect(isRetryable(makeError(502))).toBe(true);
    expect(isRetryable(makeError(503))).toBe(true);
    expect(isRetryable(makeError(504))).toBe(true);
  });

  test('400/401/403/404 → not retryable', () => {
    expect(isRetryable(makeError(400))).toBe(false);
    expect(isRetryable(makeError(401))).toBe(false);
    expect(isRetryable(makeError(403))).toBe(false);
    expect(isRetryable(makeError(404))).toBe(false);
  });

  test('network errors with code → retryable', () => {
    const err = new Error('reset');
    err.code = 'ECONNRESET';
    expect(isRetryable(err)).toBe(true);

    const err2 = new Error('timeout');
    err2.code = 'ETIMEDOUT';
    expect(isRetryable(err2)).toBe(true);
  });

  test('null/undefined → not retryable', () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });
});

describe('backoffDelayMs', () => {
  test('attempt 0: between 500 and 1000 ms (jitter range)', () => {
    for (let i = 0; i < 20; i++) {
      const d = backoffDelayMs(0);
      expect(d).toBeGreaterThanOrEqual(BASE_DELAY_MS);
      expect(d).toBeLessThan(BASE_DELAY_MS + BASE_DELAY_MS);
    }
  });

  test('attempt 4: 8000–8500 ms (2^4 * 500 + jitter)', () => {
    for (let i = 0; i < 20; i++) {
      const d = backoffDelayMs(4);
      expect(d).toBeGreaterThanOrEqual(8000);
      expect(d).toBeLessThan(8500);
    }
  });

  test('large attempt clamped to MAX_DELAY_MS (30s)', () => {
    expect(backoffDelayMs(100)).toBe(MAX_DELAY_MS);
  });
});

describe('createWithBackoff', () => {
  test('success on first attempt', async () => {
    const client = makeMockClient([{ ok: true }]);
    const result = await createWithBackoff(client, { foo: 'bar' }, { sleepFn: async () => {} });
    expect(result).toEqual({ ok: true });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  test('429 then success: retries and returns', async () => {
    const client = makeMockClient([makeError(429), { ok: true }]);
    const result = await createWithBackoff(client, {}, { sleepFn: async () => {} });
    expect(result).toEqual({ ok: true });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  test('429 then 529 then success: retries through both', async () => {
    const client = makeMockClient([makeError(429), makeError(529), { ok: true }]);
    const result = await createWithBackoff(client, {}, { sleepFn: async () => {} });
    expect(result).toEqual({ ok: true });
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  test('5 consecutive 429s: throws after MAX_ATTEMPTS', async () => {
    const client = makeMockClient(
      Array.from({ length: MAX_ATTEMPTS }, () => makeError(429, 'rate limited'))
    );
    await expect(createWithBackoff(client, {}, { sleepFn: async () => {} })).rejects.toThrow(
      'rate limited'
    );
    expect(client.messages.create).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  test('non-retryable 400: throws immediately, no retry', async () => {
    const client = makeMockClient([makeError(400, 'bad request')]);
    await expect(createWithBackoff(client, {}, { sleepFn: async () => {} })).rejects.toThrow(
      'bad request'
    );
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  test('non-retryable 401: throws immediately, no retry', async () => {
    const client = makeMockClient([makeError(401, 'unauthorized')]);
    await expect(createWithBackoff(client, {}, { sleepFn: async () => {} })).rejects.toThrow(
      'unauthorized'
    );
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  test('passes params through to client.messages.create unchanged', async () => {
    const client = makeMockClient([{ ok: true }]);
    const params = { model: 'claude-haiku-4-5', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] };
    await createWithBackoff(client, params, { sleepFn: async () => {} });
    expect(client.messages.create).toHaveBeenCalledWith(params);
  });

  test('uses the provided sleepFn between retries', async () => {
    const sleepFn = jest.fn(async () => {});
    const client = makeMockClient([makeError(429), { ok: true }]);
    await createWithBackoff(client, {}, { sleepFn });
    expect(sleepFn).toHaveBeenCalledTimes(1);
    // sleep called with a positive number
    expect(sleepFn.mock.calls[0][0]).toBeGreaterThan(0);
  });

  test('logs label and refId on retry warning', async () => {
    const client = makeMockClient([makeError(429), { ok: true }]);
    await createWithBackoff(client, {}, { label: 'reasoner', refId: 'msg-123', sleepFn: async () => {} });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('reasoner')
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('msg-123')
    );
  });
});
