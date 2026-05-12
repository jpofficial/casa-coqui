'use strict';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-appconfigdata', () => ({
  AppConfigDataClient: jest.fn(() => ({ send: mockSend })),
  StartConfigurationSessionCommand: jest.fn((input) => ({ __type: 'Start', input })),
  GetLatestConfigurationCommand: jest.fn((input) => ({ __type: 'Get', input })),
}));

const mockEmit = jest.fn();
jest.mock('./bridge-metrics', () => ({ emitBridgeMetric: mockEmit }));

const { fetchReplyEngineFlag, _resetCacheForTests } = require('./appconfig-client');

const okFlagPayload = JSON.stringify({
  flags: { reply_engine: { enabled: true } },
  values: { reply_engine: { mode: 'aws-sfn', rollout_pct: 0, enabled: true } },
});

function bytesOf(s) {
  return new TextEncoder().encode(s);
}

describe('fetchReplyEngineFlag', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockEmit.mockReset();
    _resetCacheForTests();
    process.env.APPCONFIG_APPLICATION = 'casa-coqui-reply-agent';
    process.env.APPCONFIG_ENVIRONMENT = 'prod';
    process.env.APPCONFIG_FLAGS_PROFILE = 'feature-flags';
  });

  test('happy path — returns mode + rollout_pct + version from AppConfig', async () => {
    mockSend
      .mockResolvedValueOnce({ InitialConfigurationToken: 'tok1' })
      .mockResolvedValueOnce({
        Configuration: bytesOf(okFlagPayload),
        NextPollConfigurationToken: 'tok2',
        VersionLabel: 'v3',
      });
    const flag = await fetchReplyEngineFlag();
    expect(flag.mode).toBe('aws-sfn');
    expect(flag.rollout_pct).toBe(0);
    expect(flag.version).toBe('v3');
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('cache hit within 60s — does not call AppConfig twice', async () => {
    mockSend
      .mockResolvedValueOnce({ InitialConfigurationToken: 'tok1' })
      .mockResolvedValueOnce({ Configuration: bytesOf(okFlagPayload) });
    await fetchReplyEngineFlag();
    await fetchReplyEngineFlag();
    expect(mockSend).toHaveBeenCalledTimes(2); // Start + Get; second call hits cache
  });

  test('fail-closed: AppConfig 5xx → returns legacy default + emits failure metric', async () => {
    mockSend.mockRejectedValueOnce(new Error('5xx'));
    const flag = await fetchReplyEngineFlag();
    expect(flag.mode).toBe('firebase');
    expect(flag.rollout_pct).toBe(0);
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteFailures');
  });

  test('fail-closed: malformed payload → returns legacy default + emits failure metric', async () => {
    mockSend
      .mockResolvedValueOnce({ InitialConfigurationToken: 'tok1' })
      .mockResolvedValueOnce({ Configuration: bytesOf('{not json') });
    const flag = await fetchReplyEngineFlag();
    expect(flag.mode).toBe('firebase');
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteFailures');
  });

  test('fail-closed: env vars missing → returns legacy default', async () => {
    delete process.env.APPCONFIG_APPLICATION;
    const flag = await fetchReplyEngineFlag();
    expect(flag.mode).toBe('firebase');
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteFailures');
  });
});
