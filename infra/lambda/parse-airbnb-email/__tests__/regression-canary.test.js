'use strict';

/**
 * Regression canary — locks in current parser behavior against the real
 * Airbnb email shape. If this test breaks, it likely means Airbnb changed
 * their HTML structure and the parser needs updating.
 *
 * Fixture: __tests__/fixtures/airbnb-guest-message.eml
 *   - Sourced from a real Airbnb "new message from booker" email.
 *   - PII sanitized: guest name "Jaydon" → "Tester"; Reply-To token,
 *     SES Message-ID, email Message-ID, DKIM signatures and other opaque
 *     blobs all REDACTED or replaced with synthetic tokens.
 *   - Body (text + HTML) preserves the alt="Tester" + <h2>Tester</h2> +
 *     Booker anchor pattern that the canary relies on.
 *
 * Pipeline: full mailparser → extractGuestNameFromBody / Reply-To token →
 * airbnbThreadKeyFromReplyTo. No mocks.
 */

const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const {
  extractGuestNameFromBody,
  extractAirbnbReplyToToken,
  airbnbThreadKeyFromReplyTo,
} = require('../index');

const FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'airbnb-guest-message.eml'
);

const SYNTHETIC_TOKEN = 'synthetic-token-001-aaaa-bbbb-cccc-dddd-eeee-ff';

describe('regression canary — sanitized real Airbnb email', () => {
  let parsed;

  beforeAll(async () => {
    const raw = fs.readFileSync(FIXTURE_PATH);
    parsed = await simpleParser(raw);
  });

  test('mailparser reads the fixture without error', () => {
    expect(parsed).toBeTruthy();
    expect(parsed.subject).toMatch(/Reservation for Casa Coqui/i);
    expect(parsed.from && parsed.from.text).toMatch(/express@airbnb\.com/);
  });

  test('extractGuestNameFromBody returns "Tester" via the HTML strategy', () => {
    const result = extractGuestNameFromBody(parsed.html, parsed.text);
    // result may be a bare string (current API) or an object {name, source}
    // (post-Improvement-2). Accept either shape so this test stays stable
    // across the refactor and acts as a true regression canary.
    const name = typeof result === 'string' ? result : result && result.name;
    expect(name).toBe('Tester');
  });

  test('extractAirbnbReplyToToken returns the synthetic token verbatim', () => {
    expect(extractAirbnbReplyToToken(parsed)).toBe(SYNTHETIC_TOKEN);
  });

  test('airbnbThreadKeyFromReplyTo is "airbnb:<32-hex>" — 39 chars total', () => {
    const threadKey = airbnbThreadKeyFromReplyTo(parsed);
    expect(threadKey).toMatch(/^airbnb:[a-f0-9]{32}$/);
    expect(threadKey.length).toBe(39);
  });

  test('full pipeline (subject → html → plaintext) yields Tester + airbnb threadKey', () => {
    // Subject does NOT contain a name — Airbnb emits "Reservation for Casa
    // Coqui #1 Next to everything, May 5 – 13" with no guest name. So the
    // body extractor MUST be the path that succeeds.
    expect(parsed.subject).not.toMatch(/Tester/);

    const bodyResult = extractGuestNameFromBody(parsed.html, parsed.text);
    const bodyName = typeof bodyResult === 'string' ? bodyResult : bodyResult && bodyResult.name;
    expect(bodyName).toBe('Tester');

    const threadKey = airbnbThreadKeyFromReplyTo(parsed);
    expect(threadKey).toMatch(/^airbnb:[a-f0-9]{32}$/);
  });
});
