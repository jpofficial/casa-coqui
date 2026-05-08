'use strict';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSend })),
  StartExecutionCommand: jest.fn((input) => ({ __type: 'Start', input })),
}));

const mockEmit = jest.fn();
jest.mock('./bridge-metrics', () => ({ emitBridgeMetric: mockEmit }));

const { startReplyDraftExecution } = require('./aws-sfn-bridge');

describe('startReplyDraftExecution', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockEmit.mockReset();
    process.env.REPLY_DRAFT_STATE_MACHINE_ARN =
      'arn:aws:states:us-east-1:524140443248:stateMachine:casa-coqui-reply-draft';
  });

  test('happy path — calls StartExecution + emits BridgeRouteSuccesses', async () => {
    mockSend.mockResolvedValueOnce({ executionArn: 'arn:aws:states:...:execution:abc' });
    const out = await startReplyDraftExecution({
      message: { id: 'msg-1', body: 'hi', guestName: 'A', threadKey: 'tk' },
      contextJson: '{}',
      voicePrompt: 'v',
      voiceProfilePrompt: 'vp',
      relevantConversations: [],
      thread: [],
      routedBy: 'rollout-routed',
      appConfigVersion: 'v3',
    });
    expect(out.executionArn).toBe('arn:aws:states:...:execution:abc');
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteSuccesses');
    const call = mockSend.mock.calls[0][0];
    expect(call.input.stateMachineArn).toMatch(/casa-coqui-reply-draft$/);
    const inputObj = JSON.parse(call.input.input);
    expect(inputObj.message.id).toBe('msg-1');
    expect(inputObj.message.threadKey).toBe('tk');
    expect(inputObj._routedBy).toBe('rollout-routed');
    expect(inputObj._appConfigVersion).toBe('v3');
  });

  test('error path — throws AND emits BridgeRouteFailures (caller falls back to legacy)', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(
      startReplyDraftExecution({
        message: { id: 'msg-2', body: 'b', guestName: 'B', threadKey: 'tk2' },
        contextJson: '{}',
        voicePrompt: '',
        voiceProfilePrompt: '',
        relevantConversations: [],
        thread: [],
        routedBy: 'rollout-routed',
      })
    ).rejects.toThrow('AccessDenied');
    expect(mockEmit).toHaveBeenCalledWith('BridgeRouteFailures');
  });

  test('thread context window — ports .slice(-20) per AC #16', async () => {
    mockSend.mockResolvedValueOnce({ executionArn: 'a' });
    const thread = Array.from({ length: 30 }, (_, i) => ({ body: `m${i}` }));
    await startReplyDraftExecution({
      message: { id: 'm', body: 'b', guestName: 'g', threadKey: 't' },
      contextJson: '{}',
      voicePrompt: '',
      voiceProfilePrompt: '',
      relevantConversations: [],
      thread,
      routedBy: 'rollout-routed',
    });
    const call = mockSend.mock.calls[0][0];
    const inputObj = JSON.parse(call.input.input);
    expect(inputObj.thread).toHaveLength(20);
    expect(inputObj.thread[0].body).toBe('m10');
    expect(inputObj.thread[19].body).toBe('m29');
  });
});
