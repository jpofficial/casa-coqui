'use strict';

// Mock the Anthropic SDK so `new Anthropic()` returns a client with a stubbed
// messages.create() that mimics a valid tool_use response. This lets
// non-terminal test cases run through the full generator and assert
// `skipped` is falsy on the real happy path — not via a try/catch that would
// have passed even if the guard were removed entirely.
jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [
      {
        type: 'tool_use',
        input: { message: 'test welcome', language: 'en' },
      },
    ],
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  return {
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

const { generateWelcomeMessage, TERMINAL_WELCOME_STATES } = require('../welcome-ai');

describe('generateWelcomeMessage terminal-state guard', () => {
  test('TERMINAL_WELCOME_STATES contains the 4 locked states', () => {
    expect(TERMINAL_WELCOME_STATES.has('ready')).toBe(true);
    expect(TERMINAL_WELCOME_STATES.has('sent')).toBe(true);
    expect(TERMINAL_WELCOME_STATES.has('skipped')).toBe(true);
    expect(TERMINAL_WELCOME_STATES.has('snoozed')).toBe(true);
    expect(TERMINAL_WELCOME_STATES.has('pending')).toBe(false);
    expect(TERMINAL_WELCOME_STATES.has('error')).toBe(false);
  });

  test.each(['ready', 'sent', 'skipped', 'snoozed'])(
    'skips generation when welcomeStatus is terminal: %s',
    async (status) => {
      const result = await generateWelcomeMessage({
        booking: { id: 'b1', welcomeStatus: status, welcomeMessage: 'prev' },
        settings: {},
        template: null,
      });
      expect(result.skipped).toBe(true);
      expect(result.message).toBe('prev');
    }
  );

  test('does not skip when welcomeStatus is pending', async () => {
    const result = await generateWelcomeMessage({
      booking: { id: 'b1', welcomeStatus: 'pending' },
      settings: {},
      template: null,
    });
    expect(result.skipped).toBeFalsy();
    expect(result.message).toBe('test welcome');
  });

  test('does not skip when welcomeStatus is undefined (seed-script bookings)', async () => {
    const result = await generateWelcomeMessage({
      booking: { id: 'b1' /* no welcomeStatus */ },
      settings: {},
      template: null,
    });
    expect(result.skipped).toBeFalsy();
    expect(result.message).toBe('test welcome');
  });

  test('does not skip when welcomeStatus is error (retry path)', async () => {
    const result = await generateWelcomeMessage({
      booking: { id: 'b1', welcomeStatus: 'error' },
      settings: {},
      template: null,
    });
    expect(result.skipped).toBeFalsy();
    expect(result.message).toBe('test welcome');
  });
});
