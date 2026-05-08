import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getPricingLib, getDb } from '@/lib/pricing-db';

/**
 * GET /api/pricing/competitors?unit=unit-a
 * List active competitors for a unit.
 */
export async function GET(request) {
  const { error, caller } = await requireRole(request, ['admin']);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const unit = searchParams.get('unit');
  if (!unit || !['unit-a', 'unit-b'].includes(unit)) {
    return NextResponse.json(
      { success: false, error: 'unit query param required (unit-a or unit-b)' },
      { status: 400 }
    );
  }

  // Ensure schema is initialized before querying
  getDb();
  const { db: dbLib } = getPricingLib();
  const comps = dbLib.getCompetitorsForUnit(unit);

  return NextResponse.json({ success: true, data: comps });
}

/**
 * POST /api/pricing/competitors
 * Create a new competitor.
 */
export async function POST(request) {
  const { error, caller } = await requireRole(request, ['admin']);
  if (error) return error;

  const body = await request.json();
  const { name, comp_unit, bedrooms } = body;

  if (!name || !comp_unit || bedrooms == null) {
    return NextResponse.json(
      { success: false, error: 'name, comp_unit, and bedrooms are required' },
      { status: 400 }
    );
  }
  if (!['unit-a', 'unit-b'].includes(comp_unit)) {
    return NextResponse.json(
      { success: false, error: 'comp_unit must be unit-a or unit-b' },
      { status: 400 }
    );
  }

  // Extract airbnb_id from URL if present
  let airbnbId = null;
  if (body.url) {
    const match = body.url.match(/rooms\/(\d+)/);
    airbnbId = match ? match[1] : null;
  }

  const db = getDb();
  const amenitiesJson = Array.isArray(body.amenities)
    ? JSON.stringify(body.amenities)
    : body.amenities || null;

  // Upsert by airbnb_id if available
  if (airbnbId) {
    const existing = db.prepare('SELECT id FROM competitors WHERE airbnb_id = ?').get(airbnbId);
    if (existing) {
      db.prepare(`
        UPDATE competitors SET
          name = ?, url = ?, host_name = ?, neighborhood = ?, bedrooms = ?, bathrooms = ?,
          max_guests = ?, sqft = ?, amenities = ?, rating = ?, review_count = ?,
          superhost = ?, min_nights = ?, cleaning_fee = ?, base_rate = ?, comp_unit = ?, notes = ?,
          updated_at = datetime('now')
        WHERE airbnb_id = ?
      `).run(
        name, body.url, body.host_name || null, body.neighborhood || null,
        bedrooms, body.bathrooms || 1,
        body.max_guests || null, body.sqft || null, amenitiesJson,
        body.rating || null, body.review_count || null,
        body.superhost ? 1 : 0, body.min_nights || 1,
        body.cleaning_fee || 0, body.base_rate || null, comp_unit, body.notes || null,
        airbnbId
      );
      const updated = db.prepare('SELECT * FROM competitors WHERE id = ?').get(existing.id);
      return NextResponse.json({ success: true, data: updated });
    }
  }

  const result = db.prepare(`
    INSERT INTO competitors (airbnb_id, name, url, host_name, neighborhood, bedrooms, bathrooms,
      max_guests, sqft, amenities, rating, review_count, superhost, min_nights, cleaning_fee,
      base_rate, comp_unit, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    airbnbId, name, body.url || null, body.host_name || null, body.neighborhood || null,
    bedrooms, body.bathrooms || 1,
    body.max_guests || null, body.sqft || null, amenitiesJson,
    body.rating || null, body.review_count || null,
    body.superhost ? 1 : 0, body.min_nights || 1,
    body.cleaning_fee || 0, body.base_rate || null, comp_unit, body.notes || null
  );

  const { db: dbLib } = getPricingLib();
  dbLib.logAction('comp_add', { id: result.lastInsertRowid, name, unit: comp_unit });

  const created = db.prepare('SELECT * FROM competitors WHERE id = ?').get(result.lastInsertRowid);
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}
