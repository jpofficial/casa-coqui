#!/usr/bin/env node

/**
 * Scrape the base nightly rate from an Airbnb listing using Playwright.
 *
 * Usage:
 *   node tools/pricing/scripts/scrape-airbnb-price.js <airbnb-url>
 *
 * Returns JSON to stdout: { base_rate, total, nights, source }
 * Exit code 0 on success, 1 on failure.
 */

const { scrapeBaseRate } = require('../lib/scrape-price');

const url = process.argv[2];
if (!url || !/airbnb\.[a-z.]+\/rooms\/\d+/.test(url)) {
  console.error('Usage: scrape-airbnb-price.js <airbnb-url>');
  process.exit(1);
}

(async () => {
  const result = await scrapeBaseRate(url);
  if (result.base_rate) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } else {
    console.error(JSON.stringify({ error: 'Could not extract price', ...result }, null, 2));
    process.exit(1);
  }
})();
