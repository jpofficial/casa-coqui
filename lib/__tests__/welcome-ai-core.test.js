const { test } = require('node:test');
const assert = require('node:assert');
const {
  MODEL,
  SYSTEM_PROMPT,
  WELCOME_TOOL,
  buildWelcomeInput,
  daysBetween,
  buildWelcomeRequest,
  parseWelcomeResponse,
} = require('../welcome-ai-core');

const booking = {
  id: 'bk-1',
  guestName: 'María López',
  airbnbConfirmationCode: 'HMABCD1234',
  unit: 'Casa Coqui #1',
  checkInDate: '2026-05-05',
  checkOutDate: '2026-05-09',
  guestLink: 'https://casa-coqui.com/g/ABC123',
};

test('daysBetween counts nights and tolerates missing dates', () => {
  assert.strictEqual(daysBetween('2026-05-05', '2026-05-09'), 4);
  assert.strictEqual(daysBetween(null, '2026-05-09'), null);
  assert.strictEqual(daysBetween('2026-05-05', undefined), null);
});

test('buildWelcomeInput serialises guest, stay, property and portal link', () => {
  const input = JSON.parse(buildWelcomeInput({ booking, settings: { propertyName: 'Casa Coqui', location: 'San Juan, Puerto Rico' }, template: null }));
  assert.deepStrictEqual(input.guest, { name: 'María López', confirmationCode: 'HMABCD1234' });
  assert.deepStrictEqual(input.stay, {
    unit: 'Casa Coqui #1',
    checkInDate: '2026-05-05',
    checkOutDate: '2026-05-09',
    nightCount: 4,
  });
  assert.deepStrictEqual(input.property, { name: 'Casa Coqui', location: 'San Juan, Puerto Rico' });
  assert.strictEqual(input.guestPortalLink, 'https://casa-coqui.com/g/ABC123');
  assert.strictEqual('template' in input, false);
});

test('buildWelcomeInput falls back to defaults and includes a template when given', () => {
  const input = JSON.parse(buildWelcomeInput({ booking: {}, settings: undefined, template: 'Hola {guest}!' }));
  assert.strictEqual(input.guest.name, 'Guest');
  assert.strictEqual(input.guest.confirmationCode, null);
  assert.strictEqual(input.stay.nightCount, null);
  assert.deepStrictEqual(input.property, { name: 'Casa Coqui', location: 'San Juan, Puerto Rico' });
  assert.strictEqual(input.guestPortalLink, null);
  assert.strictEqual(input.template, 'Hola {guest}!');
});

test('buildWelcomeRequest pins the model, tool and forced tool choice', () => {
  const req = buildWelcomeRequest({ system: SYSTEM_PROMPT + '\nVOICE', userMessage: '{"x":1}' });
  assert.strictEqual(req.model, MODEL);
  assert.strictEqual(req.max_tokens, 512);
  assert.strictEqual(req.system, SYSTEM_PROMPT + '\nVOICE');
  assert.deepStrictEqual(req.tools, [WELCOME_TOOL]);
  assert.deepStrictEqual(req.tool_choice, { type: 'tool', name: 'welcome_message' });
  assert.deepStrictEqual(req.messages, [{ role: 'user', content: '{"x":1}' }]);
});

test('WELCOME_TOOL requires message + language with en/es enum', () => {
  assert.strictEqual(WELCOME_TOOL.name, 'welcome_message');
  assert.deepStrictEqual(WELCOME_TOOL.input_schema.required, ['message', 'language']);
  assert.deepStrictEqual(WELCOME_TOOL.input_schema.properties.language.enum, ['en', 'es']);
});

test('parseWelcomeResponse returns the draft plus an agent_runs entry', () => {
  const response = {
    content: [{ type: 'text', text: 'thinking…' }, { type: 'tool_use', input: { message: 'Hola María', language: 'es' } }],
    usage: { input_tokens: 10, output_tokens: 20 },
  };
  const startTime = Date.now() - 5;
  const result = parseWelcomeResponse(response, { booking, userMessage: '{"x":1}', startTime });
  assert.strictEqual(result.message, 'Hola María');
  assert.strictEqual(result.language, 'es');
  assert.strictEqual(result._agentRun.kind, 'welcome');
  assert.strictEqual(result._agentRun.refId, 'bk-1');
  assert.strictEqual(result._agentRun.model, MODEL);
  assert.strictEqual(result._agentRun.inputTokens, 10);
  assert.strictEqual(result._agentRun.outputTokens, 20);
  assert.ok(result._agentRun.latencyMs >= 5);
  assert.strictEqual(result._agentRun.prompt, '{"x":1}');
  assert.strictEqual(result._agentRun.response, JSON.stringify({ message: 'Hola María', language: 'es' }));
  assert.strictEqual(result._agentRun.escalated, false);
});

test('parseWelcomeResponse defaults empty fields and throws without a tool_use block', () => {
  const ok = parseWelcomeResponse(
    { content: [{ type: 'tool_use', input: {} }] },
    { booking: {}, userMessage: '', startTime: Date.now() }
  );
  assert.strictEqual(ok.message, '');
  assert.strictEqual(ok.language, 'en');
  assert.strictEqual(ok._agentRun.refId, null);
  assert.strictEqual(ok._agentRun.inputTokens, 0);

  assert.throws(
    () => parseWelcomeResponse({ content: [{ type: 'text', text: 'nope' }] }, { booking: {}, userMessage: '', startTime: Date.now() }),
    /AI did not return a structured welcome message/
  );
});
