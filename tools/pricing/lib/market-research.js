/**
 * Market Research Engine — Playwright-based Airbnb search + listing scraper.
 *
 * Searches Airbnb for competing listings matching criteria, then scrapes
 * full details + pricing for 3 stay lengths per listing.
 *
 * Usage (CJS):
 *   const { launchBrowser, scrapeSearchResults, scrapeListingDetails } = require('./market-research');
 */

const { chromium } = require('playwright');
const { extractFromDeferredState, extractPriceFromJson } = require('./extract-listing');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function launchBrowser(opts = {}) {
  return chromium.launch({
    headless: !opts.headful,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });
}

async function createContext(browser) {
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  // Override webdriver property
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return context;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function computeDateRanges(startDate) {
  const start = startDate ? new Date(startDate) : new Date();
  // If start is in the past, use tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (start < tomorrow) start.setTime(tomorrow.getTime());

  const ranges = [
    { label: '1 week', nights: 7 },
    { label: '2 weeks', nights: 14 },
    { label: '1 month', nights: 28 },
  ];

  return ranges.map(({ label, nights }) => {
    const checkin = new Date(start);
    const checkout = new Date(start);
    checkout.setDate(checkout.getDate() + nights);
    return {
      label,
      nights,
      checkin: formatDate(checkin),
      checkout: formatDate(checkout),
    };
  });
}

/**
 * V2 date ranges — 5 stay lengths for multi-stay analysis.
 * Produces ranges for 1, 2, 3, 4, 7 nights from the start date.
 */
function computeDateRangesV2(startDate) {
  const start = startDate ? new Date(startDate) : new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (start < tomorrow) start.setTime(tomorrow.getTime());

  const ranges = [
    { label: '1n', nights: 1 },
    { label: '2n', nights: 2 },
    { label: '3n', nights: 3 },
    { label: '4n', nights: 4 },
    { label: '7n', nights: 7 },
  ];

  return ranges.map(({ label, nights }) => {
    const checkin = new Date(start);
    const checkout = new Date(start);
    checkout.setDate(checkout.getDate() + nights);
    return {
      label,
      nights,
      checkin: formatDate(checkin),
      checkout: formatDate(checkout),
    };
  });
}

// ---------------------------------------------------------------------------
// Anti-detection
// ---------------------------------------------------------------------------

async function jitterWait(page, baseMs = 3000) {
  const jitter = Math.floor(Math.random() * 2000);
  await page.waitForTimeout(baseMs + jitter);
}

function isCaptchaPage(html) {
  // Check for actual CAPTCHA challenge pages (not config JSON that mentions recaptcha)
  // A real CAPTCHA page has very little normal content — no listing cards
  const hasListings = /data-testid="card-container"|\/rooms\/\d+/.test(html);
  if (hasListings) return false;
  return /captcha-container|verify you are a human|press & hold|perimeterx\.com|px-captcha/i.test(html);
}

/**
 * Dismiss common Airbnb modals — cookie consent, translation popup,
 * "close" buttons on overlays, etc.
 * Uses Playwright native clicks + Escape key for reliability.
 */
async function dismissModals(page, onProgress) {
  // Try Escape key first — dismisses most modals
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Try clicking close buttons with Playwright's native click
  const closeSelectors = [
    'button[aria-label="Close"]',
    'button[aria-label="Cerrar"]',
    'button[aria-label="Dismiss"]',
    '[role="dialog"] button[aria-label="Close"]',
    'div[aria-modal="true"] button[aria-label="Close"]',
    '[data-testid="modal-container"] button',
    '[data-testid="accept-btn"]',
    // SVG close icon buttons (X buttons)
    '[role="dialog"] button:has(svg)',
    'div[aria-modal="true"] button:has(svg)',
  ];

  let dismissed = 0;
  for (const sel of closeSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 300 })) {
        await btn.click({ timeout: 1000 });
        dismissed++;
        await page.waitForTimeout(500);
      }
    } catch { /* selector not found or not clickable */ }
  }

  // Final Escape in case something else popped up
  if (dismissed > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  if (dismissed > 0 && onProgress) {
    onProgress(`Dismissed ${dismissed} modal(s)`);
  }
}

// ---------------------------------------------------------------------------
// Search URL builder
// ---------------------------------------------------------------------------

// Known metro bounding boxes (SW corner → NE corner)
// These constrain the Airbnb map to a specific geographic area.
const METRO_BOUNDS = {
  'san juan': { sw_lat: 18.30, sw_lng: -66.20, ne_lat: 18.50, ne_lng: -65.88 },
};

function buildSearchUrl(config, dateRange) {
  const params = new URLSearchParams();
  if (config.min_bedrooms) params.set('min_bedrooms', config.min_bedrooms);
  if (config.min_bathrooms) params.set('min_bathrooms', config.min_bathrooms);
  if (dateRange) {
    params.set('checkin', dateRange.checkin);
    params.set('checkout', dateRange.checkout);
  }
  params.set('adults', '2');
  // Entire place filter
  params.set('l2_property_type_ids[]', '1');

  // Price range filters
  if (config.min_price) params.set('price_min', config.min_price);
  if (config.max_price) params.set('price_max', config.max_price);

  // Geo bounding box — keeps results within the metro area
  const cityKey = config.location.split(',')[0].trim().toLowerCase();
  const bounds = METRO_BOUNDS[cityKey];
  if (bounds) {
    params.set('ne_lat', bounds.ne_lat);
    params.set('ne_lng', bounds.ne_lng);
    params.set('sw_lat', bounds.sw_lat);
    params.set('sw_lng', bounds.sw_lng);
    params.set('search_by_map', 'true');
  }

  const location = encodeURIComponent(config.location);
  return `https://www.airbnb.com/s/${location}/homes?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Search results extraction
// ---------------------------------------------------------------------------

async function scrapeSearchResults(page, config, onProgress) {
  // Use explicit checkin/checkout from config if set, otherwise default 1-week range
  let dateRange;
  if (config.start_date && config.checkout_date) {
    dateRange = {
      label: 'custom',
      checkin: config.start_date,
      checkout: config.checkout_date,
      nights: Math.round((new Date(config.checkout_date) - new Date(config.start_date)) / 86400000),
    };
  } else {
    dateRange = computeDateRanges(config.start_date)[0]; // Use 1-week for search
  }
  const url = buildSearchUrl(config, dateRange);

  if (onProgress) onProgress(`Navigating to search: ${config.location}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Dismiss common popups (cookie consent, translation modal, etc.)
  await dismissModals(page, onProgress);

  // Check for CAPTCHA
  const pageHtml = await page.content();
  if (isCaptchaPage(pageHtml)) {
    // Save screenshot for debugging
    const path = require('path');
    const ssPath = path.join(__dirname, '..', 'debug-captcha.png');
    await page.screenshot({ path: ssPath, fullPage: true });
    if (onProgress) onProgress(`CAPTCHA detected — screenshot saved to ${ssPath}`);
    if (onProgress) onProgress('Waiting 60s for manual solve...');
    // In headful mode, user can solve it; poll every 5s
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      const html = await page.content();
      if (!isCaptchaPage(html)) {
        if (onProgress) onProgress('CAPTCHA solved, continuing...');
        break;
      }
      if (i === 11) {
        throw new Error('CAPTCHA not solved after 60s. Try --headful mode to solve manually.');
      }
    }
  }

  // Scroll to load all cards (lazy-loaded)
  const maxScrolls = 10;
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(1000);
  }

  // Extract listings from page
  let listings = await extractSearchListings(page);
  if (onProgress) onProgress(`Found ${listings.length} listings on page 1`);

  // If we got a full page and need more, try page 2
  const maxResults = config.max_results || 20;
  if (listings.length >= 18 && listings.length < maxResults) {
    if (onProgress) onProgress('Loading page 2...');
    const page2Url = url + `&items_offset=${listings.length}`;
    await jitterWait(page);
    await page.goto(page2Url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(800);
    }

    const page2Listings = await extractSearchListings(page);
    if (onProgress) onProgress(`Found ${page2Listings.length} listings on page 2`);
    listings = listings.concat(page2Listings);
  }

  // Deduplicate by airbnb_id
  const seen = new Set();
  listings = listings.filter((l) => {
    if (!l.airbnb_id || seen.has(l.airbnb_id)) return false;
    seen.add(l.airbnb_id);
    return true;
  });

  // Soft geo-filter: remove listings clearly outside the target area.
  // Airbnb search is already location-bounded, so most results are relevant.
  // Only filter if listing name explicitly mentions a different city.
  // If filtering would drop >50% of results, skip it — the search already constrains location.
  const city = config.location.split(',')[0].trim().toLowerCase();
  const nearby = (config.nearby_areas || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowedAreas = [city, ...nearby];

  const before = listings.length;
  // Pattern: "Home in <City>" or "Rental unit in <City>" — extract the location part
  const locationPattern = /(?:in|en)\s+([A-Za-zÀ-ÿ\s]+?)$/i;
  const filtered = listings.filter((l) => {
    const name = (l.name || '').trim();
    const match = name.match(locationPattern);
    if (!match) return true; // No location in name — keep it (search is already geo-bounded)
    const listingCity = match[1].trim().toLowerCase();
    return allowedAreas.some((area) => listingCity.includes(area) || area.includes(listingCity));
  });

  // Only apply filter if it keeps more than half the results
  if (filtered.length >= before * 0.5) {
    listings = filtered;
    if (onProgress && listings.length < before) {
      onProgress(`Filtered to ${listings.length} listings in ${allowedAreas.join(', ')} (excluded ${before - listings.length} outside area)`);
    }
  } else if (onProgress && filtered.length < before) {
    onProgress(`Geo-filter skipped — would drop ${before - filtered.length}/${before} results. Airbnb search is already location-bounded.`);
  }

  // Limit to max_results
  return listings.slice(0, maxResults);
}

async function extractSearchListings(page) {
  // Strategy 1: Extract from data-deferred-state JSON
  const jsonListings = await page.evaluate(() => {
    const results = [];
    const scripts = document.querySelectorAll('script[data-deferred-state]');
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent);
        const str = JSON.stringify(json);
        // Find search results in the JSON
        const listingMatches = str.matchAll(/"listing"\s*:\s*\{[^]*?"id"\s*:\s*"(\d+)"[^]*?"name"\s*:\s*"([^"]*?)"/g);
        for (const m of listingMatches) {
          results.push({ airbnb_id: m[1], name: m[2] });
        }
      } catch { /* skip */ }
    }
    return results;
  });

  if (jsonListings.length > 0) return jsonListings;

  // Strategy 2: DOM fallback — listing cards
  return page.evaluate(() => {
    const results = [];
    // Airbnb listing cards have links to /rooms/{id}
    const links = document.querySelectorAll('a[href*="/rooms/"]');
    const seen = new Set();
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const idMatch = href.match(/\/rooms\/(\d+)/);
      if (!idMatch) continue;
      const airbnbId = idMatch[1];
      if (seen.has(airbnbId)) continue;
      seen.add(airbnbId);

      // Try to get name from nearby text
      const card = link.closest('[data-testid]') || link.closest('[role="group"]') || link.parentElement;
      const name = card?.querySelector('[data-testid="listing-card-title"]')?.textContent?.trim()
        || card?.querySelector('[id^="title_"]')?.textContent?.trim()
        || '';

      // Try to get rate
      const priceText = card?.textContent || '';
      const rateMatch = priceText.match(/\$(\d+)\s*(?:\/\s*)?night/i);
      const rate = rateMatch ? Number(rateMatch[1]) : null;

      // Try to get rating
      const ratingMatch = priceText.match(/([\d.]+)\s*\((\d+)\)/);
      const rating = ratingMatch ? Number(ratingMatch[1]) : null;
      const reviewCount = ratingMatch ? Number(ratingMatch[2]) : null;

      results.push({
        airbnb_id: airbnbId,
        name: name || `Listing ${airbnbId}`,
        base_rate: rate,
        rating,
        review_count: reviewCount,
      });
    }
    return results;
  });
}

// ---------------------------------------------------------------------------
// Calendar availability helpers
// ---------------------------------------------------------------------------

/**
 * Compute the set of YYYY-MM month strings that a search window touches.
 * Uses checkout - 1 day as the last night (checkout is departure, exclusive).
 */
function getRelevantMonths(startDate, checkoutDate) {
  const lastNight = new Date(checkoutDate + 'T00:00:00');
  lastNight.setDate(lastNight.getDate() - 1);

  const months = new Set();
  const cursor = new Date(startDate + 'T00:00:00');
  while (cursor <= lastNight) {
    months.add(cursor.toISOString().slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
  }
  return months;
}

/**
 * Parse the PdpAvailabilityCalendar GraphQL response into day objects.
 * Null handling: d.available === true → 'available'; === false → 'unavailable'; else → 'unknown'.
 * Display: 'available' only when raw is 'available'; otherwise 'not_available'.
 */
function parseCalendarDays(json) {
  const days = [];
  try {
    const calendarMonths = json?.data?.merlin?.pdpAvailabilityCalendar?.calendarMonths;
    if (!Array.isArray(calendarMonths)) return days;

    for (const month of calendarMonths) {
      if (!Array.isArray(month.days)) continue;
      for (const d of month.days) {
        if (!d.calendarDate) continue;
        const rawStatus = d.available === true ? 'available'
          : d.available === false ? 'unavailable'
          : 'unknown';
        days.push({
          date: d.calendarDate,
          rawStatus,
          displayStatus: rawStatus === 'available' ? 'available' : 'not_available',
          minNights: d.minNights ?? null,
          maxNights: d.maxNights ?? null,
          availableForCheckin: d.availableForCheckin ?? false,
          availableForCheckout: d.availableForCheckout ?? false,
        });
      }
    }
  } catch { /* malformed response — return empty */ }
  return days;
}

// ---------------------------------------------------------------------------
// Listing detail extraction
// ---------------------------------------------------------------------------

async function scrapeListingDetails(page, airbnbId, dateRanges, onProgress, opts = {}) {
  const details = {
    airbnb_id: airbnbId,
    url: `https://www.airbnb.com/rooms/${airbnbId}`,
    prices: {}, // keyed by range label
  };

  // Calendar availability interceptor — listen for PdpAvailabilityCalendar XHR
  let calendarPromise = null;
  let calendarHandler = null;
  if (opts.captureCalendar) {
    calendarPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 15000);
      calendarHandler = async (response) => {
        try {
          const url = response.url();
          if (!url.includes('PdpAvailabilityCalendar')) return;
          const json = await response.json();
          clearTimeout(timeout);
          resolve(json);
        } catch { /* ignore parse errors */ }
      };
      page.on('response', calendarHandler);
    });
  }

  for (let i = 0; i < dateRanges.length; i++) {
    const range = dateRanges[i];
    const listingUrl = `https://www.airbnb.com/rooms/${airbnbId}?adults=2&check_in=${range.checkin}&check_out=${range.checkout}`;

    if (onProgress) onProgress(`  ${airbnbId}: fetching ${range.label} (${range.checkin} → ${range.checkout})`);

    await jitterWait(page);

    try {
      await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);

      // Dismiss modals + check CAPTCHA
      await dismissModals(page);
      const html = await page.content();
      if (isCaptchaPage(html)) {
        if (onProgress) onProgress(`  ${airbnbId}: CAPTCHA on ${range.label}, skipping`);
        continue;
      }

      // On first visit, extract full details + resolve calendar
      if (i === 0) {
        const deferredData = await page.evaluate(() => {
          const script = document.querySelector('script[data-deferred-state]');
          if (!script) return null;
          try { return JSON.parse(script.textContent); } catch { return null; }
        });

        if (deferredData) {
          extractFromDeferredState(deferredData, details);
        }

        // Resolve calendar interceptor on first page load
        if (calendarPromise) {
          const calJson = await calendarPromise;
          if (calJson) {
            details.calendarRaw = parseCalendarDays(calJson);
            if (onProgress) onProgress(`  ${airbnbId}: captured ${details.calendarRaw.length} calendar days`);
          }
          // Remove handler — only need it on first load
          if (calendarHandler) page.removeListener('response', calendarHandler);
        }
      }

      // Extract price for this date range
      const priceData = await page.evaluate(() => {
        const script = document.querySelector('script[data-deferred-state]');
        if (!script) return null;
        try { return JSON.parse(script.textContent); } catch { return null; }
      });

      let price = { total: null, nightly_rate: null, cleaning_fee: null, nights: range.nights };

      if (priceData) {
        price = { ...price, ...extractPriceFromJson(priceData) };
      }

      // DOM fallback for price
      if (price.nightly_rate == null) {
        const domPrice = await page.evaluate((refNights) => {
          const out = { nightly_rate: null, total: null };
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const text = walker.currentNode.textContent.trim();
            const m = text.match(/^\$([0-9,]+)\s*\/?\s*night$/i);
            if (m) {
              out.nightly_rate = Number(m[1].replace(/,/g, ''));
              return out;
            }
          }
          // Fallback: find total
          const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const prices = [];
          while (walker2.nextNode()) {
            const text = walker2.currentNode.textContent.trim();
            const m = text.match(/^\$([0-9,]+)$/);
            if (m) {
              const amount = Number(m[1].replace(/,/g, ''));
              if (amount >= 100) prices.push(amount);
            }
          }
          if (prices.length > 0) {
            prices.sort((a, b) => b - a);
            out.total = prices[0];
            out.nightly_rate = Math.round(out.total / refNights);
          }
          return out;
        }, range.nights);

        if (domPrice.nightly_rate) {
          price.nightly_rate = domPrice.nightly_rate;
          price.total = domPrice.total || price.total;
        }
      }

      details.prices[range.label] = price;

      // Also use first range price as base_rate if not already set
      if (i === 0 && price.nightly_rate && !details.base_rate) {
        details.base_rate = price.nightly_rate;
      }
      if (i === 0 && price.cleaning_fee && !details.cleaning_fee) {
        details.cleaning_fee = price.cleaning_fee;
      }
    } catch (err) {
      if (onProgress) onProgress(`  ${airbnbId}: error on ${range.label}: ${err.message}`);
      details.prices[range.label] = { error: err.message };
    }
  }

  return details;
}

module.exports = {
  launchBrowser,
  createContext,
  computeDateRanges,
  computeDateRangesV2,
  buildSearchUrl,
  scrapeSearchResults,
  scrapeListingDetails,
  isCaptchaPage,
  getRelevantMonths,
  parseCalendarDays,
};
