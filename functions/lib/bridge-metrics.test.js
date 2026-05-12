'use strict';

jest.mock('@aws-sdk/client-cloudwatch', () => {
  const send = jest.fn();
  return {
    CloudWatchClient: jest.fn(() => ({ send })),
    PutMetricDataCommand: jest.fn((input) => ({ __type: 'PutMetricDataCommand', input })),
    __mockSend: send,
  };
});

const { __mockSend } = require('@aws-sdk/client-cloudwatch');
const { emitBridgeMetric } = require('./bridge-metrics');

describe('emitBridgeMetric', () => {
  beforeEach(() => __mockSend.mockReset());

  test('sends a PutMetricDataCommand with the right namespace + metric name', async () => {
    __mockSend.mockResolvedValueOnce({});
    await emitBridgeMetric('BridgeRouteSuccesses');
    expect(__mockSend).toHaveBeenCalledTimes(1);
    const call = __mockSend.mock.calls[0][0];
    expect(call.input.Namespace).toBe('CasaCoqui/Bridge');
    expect(call.input.MetricData[0].MetricName).toBe('BridgeRouteSuccesses');
    expect(call.input.MetricData[0].Value).toBe(1);
    expect(call.input.MetricData[0].Unit).toBe('Count');
  });

  test('swallows errors — never throws', async () => {
    __mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(emitBridgeMetric('BridgeRouteFailures')).resolves.toBeUndefined();
  });

  test('accepts an explicit value', async () => {
    __mockSend.mockResolvedValueOnce({});
    await emitBridgeMetric('BridgeRouteFailures', 5);
    const call = __mockSend.mock.calls[0][0];
    expect(call.input.MetricData[0].Value).toBe(5);
  });
});
