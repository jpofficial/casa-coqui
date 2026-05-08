import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/lib/pricing-db';

/**
 * GET /api/pricing/research-config?unit=unit-a
 * Returns the research config + last run info for a unit.
 */
export async function GET(request) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const unit = searchParams.get('unit');
  if (!unit) {
    return NextResponse.json({ success: false, error: 'unit param required' }, { status: 400 });
  }

  const db = getDb();
  const config = db.prepare('SELECT * FROM research_config WHERE comp_unit = ?').get(unit);
  const lastRun = db.prepare(
    'SELECT * FROM research_runs WHERE comp_unit = ? ORDER BY started_at DESC LIMIT 1'
  ).get(unit);

  return NextResponse.json({
    success: true,
    data: { config: config || null, lastRun: lastRun || null },
  });
}

/**
 * POST /api/pricing/research-config
 * Upserts research config for a unit.
 */
export async function POST(request) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const body = await request.json();
  const { comp_unit, location, min_bedrooms, max_bedrooms, min_bathrooms, max_results, start_date, checkout_date, min_price, max_price, notes } = body;

  if (!comp_unit || !location) {
    return NextResponse.json(
      { success: false, error: 'comp_unit and location are required' },
      { status: 400 }
    );
  }

  const db = getDb();

  db.prepare(`
    INSERT INTO research_config (comp_unit, location, min_bedrooms, max_bedrooms, min_bathrooms, max_results, start_date, checkout_date, min_price, max_price, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(comp_unit) DO UPDATE SET
      location = excluded.location,
      min_bedrooms = excluded.min_bedrooms,
      max_bedrooms = excluded.max_bedrooms,
      min_bathrooms = excluded.min_bathrooms,
      max_results = excluded.max_results,
      start_date = excluded.start_date,
      checkout_date = excluded.checkout_date,
      min_price = excluded.min_price,
      max_price = excluded.max_price,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).run(
    comp_unit,
    location,
    min_bedrooms || 4,
    max_bedrooms || null,
    min_bathrooms || 1,
    max_results || 20,
    start_date || null,
    checkout_date || null,
    min_price || null,
    max_price || null,
    notes || null
  );

  const config = db.prepare('SELECT * FROM research_config WHERE comp_unit = ?').get(comp_unit);

  return NextResponse.json({ success: true, data: config });
}
