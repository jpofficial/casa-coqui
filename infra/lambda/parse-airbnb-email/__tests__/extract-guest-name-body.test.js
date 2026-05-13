'use strict';

const { extractGuestNameFromBody } = require('../index');

// ---------------------------------------------------------------------------
// Real-Airbnb-shaped HTML — alt="Jaydon" + <h2>Jaydon</h2> + Booker anchor.
// ---------------------------------------------------------------------------
const REAL_HTML_JAYDON = [
  '<html><body>',
  '<img alt="Airbnb" src="...">',
  '<img alt="Jaydon" src="https://photos.airbnb.com/...">',
  '<div>',
  '<h2 class="atm_c8" style="color:#222">Jaydon</h2>',
  '</div>',
  '<div style="padding-top:4px">',
  '<p style="font-size:14px">Booker</p>',
  '</div>',
  '<p>Got that sorted out thank you...</p>',
  '<img alt="Casa Coqui #1 Next to everything" src="...">',
  '<img alt="Julio" src="...">',
  '<img alt="App Store" src="...">',
  '<img alt="Google Play" src="...">',
  '</body></html>',
].join('\n');

// ---------------------------------------------------------------------------
// Return shape: { name: string|null, source: 'html' | 'plaintext' | null }
// ---------------------------------------------------------------------------
describe('extractGuestNameFromBody — return shape', () => {
  test('returns { name, source } object on success', () => {
    const result = extractGuestNameFromBody(REAL_HTML_JAYDON, '');
    expect(result).toEqual({ name: 'Jaydon', source: 'html' });
  });

  test('returns { name: null, source: null } on total failure', () => {
    expect(extractGuestNameFromBody('', '')).toEqual({ name: null, source: null });
    expect(extractGuestNameFromBody(null, null)).toEqual({ name: null, source: null });
  });
});

describe('extractGuestNameFromBody — HTML extraction', () => {
  test('extracts "Jaydon" from real Airbnb HTML — alt="Jaydon" + <h2>Jaydon</h2> + Booker anchor', () => {
    expect(extractGuestNameFromBody(REAL_HTML_JAYDON, '')).toEqual({
      name: 'Jaydon',
      source: 'html',
    });
  });

  test('does not match the host name "Julio" which has NO Booker tag adjacent', () => {
    // "Julio" appears as alt later in HTML but never has a <h2>Julio</h2>+Booker pair
    expect(extractGuestNameFromBody(REAL_HTML_JAYDON, '').name).not.toBe('Julio');
  });

  test('rejects sentinel matches: alt="Airbnb"', () => {
    const html = '<img alt="Airbnb"><h2>Airbnb</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toEqual({ name: null, source: null });
  });

  test('rejects sentinel matches: alt="Casa Coqui"', () => {
    const html = '<img alt="Casa Coqui"><h2>Casa Coqui</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toEqual({ name: null, source: null });
  });

  test('rejects sentinel matches: alt="App Store", "Google Play", "TikTok", "Instagram", "Twitter", "Facebook"', () => {
    for (const sentinel of ['App Store', 'Google Play', 'TikTok', 'Instagram', 'Twitter', 'Facebook']) {
      const html = `<img alt="${sentinel}"><h2>${sentinel}</h2><p>Booker</p>`;
      expect(extractGuestNameFromBody(html, '')).toEqual({ name: null, source: null });
    }
  });

  test('returns null when no Booker anchor present', () => {
    const html = '<img alt="Jaydon"><h2>Jaydon</h2><p>Some other text</p>';
    expect(extractGuestNameFromBody(html, '')).toEqual({ name: null, source: null });
  });

  test('handles unicode names — "José"', () => {
    const html = '<img alt="José"><h2>José</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toEqual({ name: 'José', source: 'html' });
  });

  test('handles HTML-entity-encoded names — alt="Jos&eacute;"', () => {
    const html = '<img alt="Jos&eacute;"><h2>Jos&eacute;</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toEqual({ name: 'José', source: 'html' });
  });

  test('handles names with apostrophes — alt="O\'Brien"', () => {
    const html = "<img alt=\"O'Brien\"><h2>O'Brien</h2><p>Booker</p>";
    expect(extractGuestNameFromBody(html, '')).toEqual({ name: "O'Brien", source: 'html' });
  });

  test('does not match when guest name in alt differs from name in <h2>', () => {
    // alt="Jaydon" but <h2>Casa Coqui</h2> — mismatch should reject
    const html = '<img alt="Jaydon"><h2>Casa Coqui</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toEqual({ name: null, source: null });
  });

  test('caps HTML processing at the configured limit (defense against ReDoS + spurious matches deep in email)', () => {
    // Place the Jaydon match WAY past the cap (50KB padding) — should not match.
    const padding = 'x'.repeat(50000);
    const html = padding + '<img alt="Jaydon"><h2>Jaydon</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toEqual({ name: null, source: null });
  });
});

describe('extractGuestNameFromBody — plaintext fallback', () => {
  test('extracts "Jaydon" from plaintext "   JAYDON\\n   Booker" and title-cases', () => {
    const text = '   JAYDON\n   Booker\n   Some message...';
    expect(extractGuestNameFromBody('', text)).toEqual({ name: 'Jaydon', source: 'plaintext' });
  });

  test('extracts via plaintext when HTML is missing/empty (source: plaintext)', () => {
    const text = '   JAYDON\n   Booker\n';
    expect(extractGuestNameFromBody(null, text)).toEqual({ name: 'Jaydon', source: 'plaintext' });
  });

  test('handles accented uppercase plaintext — "JOSÉ\\nBooker"', () => {
    const text = '   JOSÉ\n   Booker\n   ...';
    expect(extractGuestNameFromBody('', text)).toEqual({ name: 'José', source: 'plaintext' });
  });

  test('returns null on empty html and empty text', () => {
    expect(extractGuestNameFromBody('', '')).toEqual({ name: null, source: null });
    expect(extractGuestNameFromBody(null, null)).toEqual({ name: null, source: null });
  });
});

describe('extractGuestNameFromBody — priority', () => {
  test('prefers HTML over plaintext when both present and disagree (source: html)', () => {
    const html = '<img alt="Alice"><h2>Alice</h2><p>Booker</p>';
    const text = '   BOB\n   Booker\n';
    expect(extractGuestNameFromBody(html, text)).toEqual({ name: 'Alice', source: 'html' });
  });

  test('prefers HTML even when plaintext could also extract — source: html', () => {
    const html = '<img alt="Alice"><h2>Alice</h2><p>Booker</p>';
    const text = '   ALICE\n   Booker\n';
    expect(extractGuestNameFromBody(html, text)).toEqual({ name: 'Alice', source: 'html' });
  });
});
