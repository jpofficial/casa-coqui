'use strict';

// Why this test exists: the throttle wrapper, when its retry budget is
// exhausted on a 429/529, MUST re-throw with err.name === 'AnthropicThrottle'.
// That string is a contract with ai-chain.asl.json's Retry blocks, which
// declare ErrorEquals: ["AnthropicThrottle"]. A typo here ('AntropicThrottle')
// would silently disable every Retry — SFN won't match, falls through to
// States.TaskFailed (which ALSO matches all our Retry blocks), so the chain
// would *appear* to work until a real 429 hits and the wrong backoff curve
// runs. This 5-line test is cheap insurance against that string drift.

const { callWithBackoff } = require('../index');

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('exhausted throttle re-throws with name="AnthropicThrottle"', async () => {
  const err429 = Object.assign(new Error('rate limited'), { status: 429 });
  const fakeClient = {
    messages: { create: jest.fn(async () => { throw err429; }) },
  };
  await expect(
    callWithBackoff(fakeClient, { model: 'x' }, { sleepFn: () => Promise.resolve() })
  ).rejects.toMatchObject({ name: 'AnthropicThrottle' });
});
