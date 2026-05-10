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

describe('extractGuestNameFromBody — HTML extraction', () => {
  test('extracts "Jaydon" from real Airbnb HTML — alt="Jaydon" + <h2>Jaydon</h2> + Booker anchor', () => {
    expect(extractGuestNameFromBody(REAL_HTML_JAYDON, '')).toBe('Jaydon');
  });

  test('does not match the host name "Julio" which has NO Booker tag adjacent', () => {
    // "Julio" appears as alt later in HTML but never has a <h2>Julio</h2>+Booker pair
    expect(extractGuestNameFromBody(REAL_HTML_JAYDON, '')).not.toBe('Julio');
  });

  test('rejects sentinel matches: alt="Airbnb"', () => {
    const html = '<img alt="Airbnb"><h2>Airbnb</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toBeNull();
  });

  test('rejects sentinel matches: alt="Casa Coqui"', () => {
    const html = '<img alt="Casa Coqui"><h2>Casa Coqui</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toBeNull();
  });

  test('rejects sentinel matches: alt="App Store", "Google Play", "TikTok", "Instagram", "Twitter", "Facebook"', () => {
    for (const sentinel of ['App Store', 'Google Play', 'TikTok', 'Instagram', 'Twitter', 'Facebook']) {
      const html = `<img alt="${sentinel}"><h2>${sentinel}</h2><p>Booker</p>`;
      expect(extractGuestNameFromBody(html, '')).toBeNull();
    }
  });

  test('returns null when no Booker anchor present', () => {
    const html = '<img alt="Jaydon"><h2>Jaydon</h2><p>Some other text</p>';
    expect(extractGuestNameFromBody(html, '')).toBeNull();
  });

  test('handles unicode names — "José"', () => {
    const html = '<img alt="José"><h2>José</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toBe('José');
  });

  test('handles HTML-entity-encoded names — alt="Jos&eacute;"', () => {
    const html = '<img alt="Jos&eacute;"><h2>Jos&eacute;</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toBe('José');
  });

  test('handles names with apostrophes — alt="O\'Brien"', () => {
    const html = "<img alt=\"O'Brien\"><h2>O'Brien</h2><p>Booker</p>";
    expect(extractGuestNameFromBody(html, '')).toBe("O'Brien");
  });

  test('does not match when guest name in alt differs from name in <h2>', () => {
    // alt="Jaydon" but <h2>Casa Coqui</h2> — mismatch should reject
    const html = '<img alt="Jaydon"><h2>Casa Coqui</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toBeNull();
  });

  test('caps HTML processing at the configured limit (defense against ReDoS + spurious matches deep in email)', () => {
    // Place the Jaydon match WAY past the cap (50KB padding) — should not match.
    const padding = 'x'.repeat(50000);
    const html = padding + '<img alt="Jaydon"><h2>Jaydon</h2><p>Booker</p>';
    expect(extractGuestNameFromBody(html, '')).toBeNull();
  });
});

describe('extractGuestNameFromBody — plaintext fallback', () => {
  test('extracts "Jaydon" from plaintext "   JAYDON\\n   Booker" and title-cases', () => {
    const text = '   JAYDON\n   Booker\n   Some message...';
    expect(extractGuestNameFromBody('', text)).toBe('Jaydon');
  });

  test('handles accented uppercase plaintext — "JOSÉ\\nBooker"', () => {
    const text = '   JOSÉ\n   Booker\n   ...';
    expect(extractGuestNameFromBody('', text)).toBe('José');
  });

  test('returns null on empty html and empty text', () => {
    expect(extractGuestNameFromBody('', '')).toBeNull();
    expect(extractGuestNameFromBody(null, null)).toBeNull();
  });
});

describe('extractGuestNameFromBody — priority', () => {
  test('prefers HTML over plaintext when both present and disagree', () => {
    const html = '<img alt="Alice"><h2>Alice</h2><p>Booker</p>';
    const text = '   BOB\n   Booker\n';
    expect(extractGuestNameFromBody(html, text)).toBe('Alice');
  });
});
