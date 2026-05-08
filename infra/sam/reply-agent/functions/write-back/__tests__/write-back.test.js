'use strict';

// Mock firebase-admin and secrets-manager BEFORE requiring index.
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockDoc = jest.fn(() => ({ get: mockGet, update: mockUpdate }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('firebase-admin', () => ({
  apps: [{}], // pretend already initialized
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  firestore: () => ({ collection: mockCollection }),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: '{"project_id":"x"}' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

const { handler } = require('../index');

// F13: ASL passes event.input (wrapped chain payload) + event.executionArn + event.executionStartTime.
function makeEvent(overrides = {}) {
  return {
    executionArn: overrides.executionArn || 'arn:aws:states:...:execution:foo',
    executionStartTime: overrides.executionStartTime || new Date(Date.now() - 5000).toISOString(),
    input: {
      message: { id: overrides.messageId || 'msg-abc' },
      _routedBy: overrides._routedBy || 'rollout-routed',
      chainResult: {
        output: {
          reasoner: { tokens: { input: 50, output: 20 } },
          drafter: { draft: { reply: 'AI draft', rationale: 'r' }, appConfigVersion: '7', tokens: { input: 100, output: 40 } },
          evaluator: { tokens: { input: 30, output: 10 } },
          reviser: overrides.reviser, // optional
          ...(overrides.outputExtra || {}),
        },
      },
      ...(overrides.inputExtra || {}),
    },
  };
}

describe('WriteBack handler', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockDoc.mockClear();
    mockCollection.mockClear();
  });

  test('skips when inbound.editedReply is set + non-empty (Decision 7)', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ editedReply: 'Host wrote this manually.', draftStatus: 'ready' }),
    });
    const out = await handler(makeEvent());
    expect(out).toEqual({ skipped: 'host_edit', messageId: 'msg-abc' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('writes when editedReply is empty string (treated as unset)', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ editedReply: '' }) });
    mockUpdate.mockResolvedValueOnce();
    const out = await handler(makeEvent());
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(out.skipped).toBeUndefined();
  });

  test('F1: sums per-stage tokens (reasoner + drafter + evaluator + reviser?)', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    await handler(makeEvent({
      reviser: { tokens: { input: 25, output: 15 } },
    }));
    const fields = mockUpdate.mock.calls[0][0];
    // Sum: 50 + 100 + 30 + 25 = 205
    expect(fields['_agentRun.inputTokens']).toBe(205);
    // Sum: 20 + 40 + 10 + 15 = 85
    expect(fields['_agentRun.outputTokens']).toBe(85);
  });

  test('F1: handles missing reviser (optional stage) — sums to 180/70', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    await handler(makeEvent());
    const fields = mockUpdate.mock.calls[0][0];
    // Sum without reviser: 50 + 100 + 30 = 180
    expect(fields['_agentRun.inputTokens']).toBe(180);
    expect(fields['_agentRun.outputTokens']).toBe(70);
  });

  test('F1: latencyMs = Date.now() - executionStartTime (proxy)', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    const startedAt = new Date(Date.now() - 4321).toISOString();
    await handler(makeEvent({ executionStartTime: startedAt }));
    const fields = mockUpdate.mock.calls[0][0];
    expect(fields['_agentRun.latencyMs']).toBeGreaterThanOrEqual(4321);
    expect(fields['_agentRun.latencyMs']).toBeLessThan(4321 + 1000);
  });

  test('persists _agentRun.{appConfigVersion, routedBy, executionArn} per Decision 17 v3.1', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    await handler(makeEvent());
    const fields = mockUpdate.mock.calls[0][0];
    expect(fields.draftReply).toBe('AI draft');
    expect(fields['_agentRun.appConfigVersion']).toBe('7');
    expect(fields['_agentRun.routedBy']).toBe('rollout-routed');
    expect(fields['_agentRun.executionArn']).toBe('arn:aws:states:...:execution:foo');
  });

  test('appConfigVersion precedence: drafter first, reviser fallback', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    mockUpdate.mockResolvedValueOnce();
    // Drafter has no appConfigVersion; reviser has '9'
    await handler(makeEvent({
      outputExtra: {
        drafter: { draft: { reply: 'r' }, tokens: { input: 100, output: 40 } }, // no appConfigVersion
        reviser: { tokens: { input: 0, output: 0 }, appConfigVersion: '9' },
      },
    }));
    const fields = mockUpdate.mock.calls[0][0];
    expect(fields['_agentRun.appConfigVersion']).toBe('9');
  });
});
