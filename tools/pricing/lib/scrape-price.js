/**
 * Playwright-based Airbnb price scraper.
 *
 * Loads a listing page with a 5-night stay to force price rendering,
 * then extracts visible dollar amounts and computes per-night rate.
 *
 * Usage (CJS):
 *   const { scrapeBaseRate } = require('./scrape-price');
 *   const result = await scrapeBaseRate('https://www.airbnb.com/rooms/12345');
 *   // => { base_rate: 178, total: 889, nights: 5, source: 'total_discounted' }
 */

const { chromium } = require('playwright');

const REF_NIGHTS = 5;

function getNextFriday() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().split('T')[0];
}

function buildUrl(airbnbId) {
  const checkIn = getNextFriday();
  const co = new Date(checkIn);
  co.setDate(co.getDate() + REF_NIGHTS);
  const checkOut = co.toISOString().split('T')[0];
  return `https://www.airbnb.com/rooms/${airbnbId}?adults=2&check_in=${checkIn}&check_out=${checkOut}`;
}

const EXTRACT_FN = function (refNights) {
  const out = { base_rate: null, total: null, nights: refNights, source: null };

  // --- Strategy 1: "$X / night" per-night text ---
  const walker1 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker1.nextNode()) {
    const text = walker1.currentNode.textContent.trim();
    const m = text.match(/^\$([0-9,]+)\s*\/?\s*night$/i);
    if (m) {
      out.base_rate = Number(m[1].replace(/,/g, ''));
      out.source = 'per_night_text';
      return out;
    }
  }

  // --- Strategy 2: visible total prices ---
  const prices = [];
  const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker2.nextNode()) {
    const text = walker2.currentNode.textContent.trim();
    const m = text.match(/^\$([0-9,]+)$/);
    if (m) {
      const amount = Number(m[1].replace(/,/g, ''));
      if (amount < 10) continue;
      const parent = walker2.currentNode.parentElement;
      const style = parent ? window.getComputedStyle(parent) : null;
      const isStrike = style ? (
        style.textDecoration.includes('line-through') ||
        style.textDecorationLine.includes('line-through')
      ) : false;
      prices.push({ amount, isStrike });
    }
  }

  if (prices.length === 0) return out;

  // Detect actual night count from page text
  const bodyText = document.body.innerText;
  const nightsMatch = bodyText.match(/for\s+(\d+)\s+nights?/i) || bodyText.match(/(\d+)\s+nights?/i);
  const actualNights = nightsMatch ? Number(nightsMatch[1]) : refNights;
  out.nights = actualNights;

  // Prefer non-strikethrough (discounted) price
  const nonStrike = prices.filter((p) => !p.isStrike);
  const candidates = nonStrike.length > 0 ? nonStrike : prices;

  // Largest candidate is the total (smaller ones are fees)
  candidates.sort((a, b) => b.amount - a.amount);
  out.total = candidates[0].amount;
  out.base_rate = Math.round(out.total / actualNights);
  out.source = nonStrike.length > 0 ? 'total_discounted' : 'total_original';
  return out;
};

/**
 * Scrape the base nightly rate from an Airbnb listing.
 * @param {string} urlOrId — Airbnb URL or room ID
 * @param {object} [opts]
 * @param {import('playwright').Browser} [opts.browser] — reuse existing browser
 * @returns {Promise<{base_rate: number|null, total: number|null, nights: number, source: string|null}>}
 */
async function scrapeBaseRate(urlOrId, opts = {}) {
  const airbnbId = typeof urlOrId === 'string' && urlOrId.includes('/')
    ? urlOrId.match(/rooms\/(\d+)/)?.[1]
    : urlOrId;
  if (!airbnbId) return { base_rate: null, total: null, nights: REF_NIGHTS, source: null };

  const ownBrowser = !opts.browser;
  const browser = opts.browser || await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    await page.goto(buildUrl(airbnbId), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    const result = await page.evaluate(EXTRACT_FN, REF_NIGHTS);
    await context.close();
    if (ownBrowser) await browser.close();
    return result;
  } catch (err) {
    await context.close();
    if (ownBrowser) await browser.close();
    return { base_rate: null, total: null, nights: REF_NIGHTS, source: null, error: err.message };
  }
}

module.exports = { scrapeBaseRate, REF_NIGHTS };
