import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/lib/pricing-db';

/**
 * PATCH /api/pricing/competitors/[id]
 * Partial update of a competitor.
 */
export async function PATCH(request, { params }) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const { id } = await params;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM competitors WHERE id = ?').get(Number(id));
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Competitor not found' }, { status: 404 });
  }

  const body = await request.json();

  const ALLOWED = [
    'name', 'url', 'host_name', 'neighborhood', 'bedrooms', 'bathrooms',
    'max_guests', 'sqft', 'amenities', 'rating', 'review_count',
    'superhost', 'min_nights', 'cleaning_fee', 'base_rate', 'comp_unit', 'notes',
  ];

  const sets = [];
  const values = [];
  for (const key of ALLOWED) {
    if (body[key] !== undefined) {
      let val = body[key];
      if (key === 'amenities' && Array.isArray(val)) val = JSON.stringify(val);
      if (key === 'superhost') val = val ? 1 : 0;
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  values.push(Number(id));

  db.prepare(`UPDATE competitors SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM competitors WHERE id = ?').get(Number(id));

  return NextResponse.json({ success: true, data: updated });
}

/**
 * DELETE /api/pricing/competitors/[id]
 * Soft-deactivate a competitor (active = 0).
 */
export async function DELETE(request, { params }) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const { id } = await params;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM competitors WHERE id = ?').get(Number(id));
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Competitor not found' }, { status: 404 });
  }

  db.prepare("UPDATE competitors SET active = 0, updated_at = datetime('now') WHERE id = ?").run(Number(id));

  return NextResponse.json({ success: true, data: { id: Number(id), active: 0 } });
}
