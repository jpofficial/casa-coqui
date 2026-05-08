import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import * as cheerio from 'cheerio';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const {
  extractFromDeferredState,
  extractFromLdJson,
  extractFromDescription,
} = _require('../../../../../tools/pricing/lib/extract-listing.js');

const AIRBNB_URL_RE = /airbnb\.[a-z.]+\/rooms\/(\d+)/;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

/**
 * POST /api/pricing/competitors/scrape
 * Accepts { url } and returns extracted listing data.
 * Does NOT create the competitor — caller uses POST /api/pricing/competitors for that.
 */
export async function POST(request) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const body = await request.json();
  const { url } = body;

  if (!url || !AIRBNB_URL_RE.test(url)) {
    return NextResponse.json(
      { success: false, error: 'A valid Airbnb listing URL is required (airbnb.com/rooms/...)' },
      { status: 400 }
    );
  }

  const airbnbId = url.match(AIRBNB_URL_RE)[1];
  // Normalize to canonical URL (strip query params that break fetching)
  const canonicalUrl = `https://www.airbnb.com/rooms/${airbnbId}`;

  let html;
  try {
    const res = await fetch(canonicalUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `Airbnb returned ${res.status}`, partial_data: { airbnb_id: airbnbId, url: canonicalUrl } },
        { status: 502 }
      );
    }
    html = await res.text();
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e.name === 'TimeoutError' ? 'Request timed out (15s)' : `Fetch failed: ${e.message}`, partial_data: { airbnb_id: airbnbId, url: canonicalUrl } },
      { status: 502 }
    );
  }

  const $ = cheerio.load(html);
  const data = { airbnb_id: airbnbId, url: canonicalUrl };
  const missing = [];

  // ── Strategy 1: data-deferred-state JSON blob ──
  try {
    const deferredScript = $('script[data-deferred-state]').first();
    if (deferredScript.length) {
      const json = JSON.parse(deferredScript.html());
      extractFromDeferredState(json, data);
    }
  } catch { /* ignore parse errors */ }

  // ── Strategy 2: application/ld+json ──
  try {
    $('script[type="application/ld+json"]').each((_, el) => {
      const json = JSON.parse($(el).html());
      extractFromLdJson(json, data);
    });
  } catch { /* ignore */ }

  // ── Strategy 3: og meta tags ──
  if (!data.name) {
    const ogTitle = $('meta[property="og:title"]').attr('content');
    if (ogTitle) data.name = ogTitle.split(' - ')[0].trim();
  }
  const ogDesc = $('meta[property="og:description"]').attr('content') || '';
  if (ogDesc) extractFromDescription(ogDesc, data);

  // Try og:description for base rate ("$X/night" pattern)
  if (data.base_rate == null && ogDesc) {
    const m = ogDesc.match(/\$(\d+)\s*\/?\s*night/i);
    if (m) data.base_rate = Number(m[1]);
  }

  // ── Strategy 4: <title> tag ──
  if (!data.name) {
    const title = $('title').text();
    if (title) data.name = title.split(' - ')[0].trim();
  }

  // ── Strategy 5: regex on full text for any remaining gaps ──
  const bodyText = $('body').text();
  extractFromDescription(bodyText, data);

  // Determine what's missing
  const expected = ['name', 'bedrooms', 'bathrooms', 'rating', 'review_count', 'neighborhood', 'max_guests', 'host_name', 'superhost', 'cleaning_fee', 'sqft', 'base_rate'];
  for (const key of expected) {
    if (data[key] == null) missing.push(key);
  }

  return NextResponse.json({
    success: true,
    data,
    partial: missing.length > 0,
    missing,
  });
}

// Extraction helpers imported from tools/pricing/lib/extract-listing.js
