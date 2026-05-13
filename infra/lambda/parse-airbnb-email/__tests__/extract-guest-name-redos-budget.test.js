'use strict';

/**
 * ReDoS budget test — confirms that the 32KB HTML scan cap inside
 * extractGuestNameFromBody actually bounds regex execution time even on
 * adversarial input designed to trigger maximum backtracking.
 *
 * Construct a 60KB+ pathological HTML input with:
 *   - Many alt="..." attributes that almost-but-don't match a Booker anchor
 *   - Many <h2> tags scattered through the body
 *   - Misleading "Booker" keywords that aren't near any avatar
 *
 * Assert: the function returns within a generous budget (250ms) and
 * produces no false positive (name === null). The budget is intentionally
 * generous to avoid flakiness on slow CI machines — even on slow hardware,
 * a well-bounded regex on 32KB of input completes in single-digit ms; the
 * 250ms ceiling is a sanity floor, not a tightness goal.
 */

const { extractGuestNameFromBody } = require('../index');

function buildPathologicalHtml(targetSize) {
  const parts = [];
  parts.push('<html><body>');

  // Many alt attributes that are 'almost-real' candidates but never match a
  // <h2> + Booker pair. Use varied near-collision values to stress altSet.
  const altNames = ['Almost', 'Maybe', 'Perhaps', 'Could', 'Should', 'Would', 'Booker', 'Guest', 'Visitor'];
  for (let i = 0; i < 1000; i++) {
    const n = altNames[i % altNames.length] + i;
    parts.push(`<img alt="${n}" src="x">`);
  }

  // Many <h2> tags whose values are NOT in altSet — every h2 candidate
  // forces normalizeForCompare + isBlockedName + altSet.has lookups.
  for (let i = 0; i < 1000; i++) {
    parts.push(`<h2 class="some-class" style="color:#222">Heading${i}</h2>`);
  }

  // Sprinkled "Booker" keywords FAR from any avatar — the 500-char proximity
  // check should reject these.
  for (let i = 0; i < 200; i++) {
    parts.push('<p>Some text about being a Booker keyword here.</p>');
    parts.push('x'.repeat(50));
  }

  parts.push('</body></html>');

  let html = parts.join('\n');
  // Pad to exceed targetSize so the slice-cap (32KB) is exercised.
  while (html.length < targetSize) {
    html += '<p>filler ' + 'x'.repeat(100) + '</p>';
  }
  return html;
}

describe('extractGuestNameFromBody — ReDoS budget', () => {
  test('completes within budget on 60KB+ adversarial input and returns no false positive', () => {
    const html = buildPathologicalHtml(60_000);
    expect(html.length).toBeGreaterThanOrEqual(60_000);

    const start = process.hrtime.bigint();
    const result = extractGuestNameFromBody(html, '');
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    // Budget: 250ms. A correctly-bounded regex on 32KB of slice should
    // complete in single-digit ms. 250ms gives huge headroom for slow CI
    // machines without hiding catastrophic ReDoS regressions.
    expect(elapsedMs).toBeLessThan(250);

    // No false positive — none of the alt/h2 pairs match with a nearby Booker.
    expect(result).toEqual({ name: null, source: null });
  });

  test('completes within budget when given the input twice in a row (stable)', () => {
    const html = buildPathologicalHtml(60_000);

    // Two consecutive runs to catch any weird state-leak / accumulating
    // regex state pathology.
    for (let i = 0; i < 2; i++) {
      const start = process.hrtime.bigint();
      extractGuestNameFromBody(html, '');
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      expect(elapsedMs).toBeLessThan(250);
    }
  });
});
