import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/lib/pricing-db';
import { createRequire } from 'module';
import { join } from 'path';

const _require = createRequire(import.meta.url);

/**
 * POST /api/pricing/competitors/[id]/scrape-price
 *
 * Uses Playwright (headless Chromium) to scrape the base nightly rate
 * from the competitor's Airbnb listing. Updates the competitor row.
 *
 * Only works in local dev — Playwright is too heavy for Vercel serverless.
 */
export async function POST(request, { params }) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const { id } = await params;
  const db = getDb();
  const comp = db.prepare('SELECT * FROM competitors WHERE id = ?').get(Number(id));

  if (!comp) {
    return NextResponse.json({ success: false, error: 'Competitor not found' }, { status: 404 });
  }
  if (!comp.url || !/airbnb\.[a-z.]+\/rooms\/\d+/.test(comp.url)) {
    return NextResponse.json({ success: false, error: 'No valid Airbnb URL on this competitor' }, { status: 400 });
  }

  let scrapeBaseRate;
  try {
    // Use process.cwd() because webpack rewrites __dirname in .next/server/
    const modPath = join(process.cwd(), 'tools', 'pricing', 'lib', 'scrape-price.js');
    const mod = _require(modPath);
    scrapeBaseRate = mod.scrapeBaseRate;
  } catch (e) {
    return NextResponse.json(
      { success: false, error: 'Playwright not available. Run: npm install playwright' },
      { status: 500 }
    );
  }

  try {
    const result = await scrapeBaseRate(comp.url);

    if (!result.base_rate) {
      return NextResponse.json({
        success: false,
        error: 'Could not extract price from listing',
        details: result,
      }, { status: 422 });
    }

    // Update the competitor
    db.prepare("UPDATE competitors SET base_rate = ?, updated_at = datetime('now') WHERE id = ?")
      .run(result.base_rate, Number(id));

    const updated = db.prepare('SELECT * FROM competitors WHERE id = ?').get(Number(id));

    return NextResponse.json({
      success: true,
      data: updated,
      scrape: {
        base_rate: result.base_rate,
        total: result.total,
        nights: result.nights,
        source: result.source,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: `Scrape failed: ${e.message}` },
      { status: 500 }
    );
  }
}
