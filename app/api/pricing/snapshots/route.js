import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/lib/pricing-db';

/**
 * GET /api/pricing/snapshots?unit=unit-a&date=2026-04-01
 * Returns per-comp TCPN snapshots for a specific date (from snapshots_v2).
 */
export async function GET(request) {
  const { error } = await requireRole(request, ['admin', 'cohost']);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const unit = searchParams.get('unit');
  const date = searchParams.get('date');

  if (!unit || !date) {
    return NextResponse.json(
      { success: false, error: 'unit and date query params are required' },
      { status: 400 }
    );
  }

  const db = getDb();

  const rows = db.prepare(`
    SELECT sv.check_date, sv.stay_nights, sv.nightly_rate, sv.cleaning_fee,
           sv.tcpn, sv.available, sv.captured_at,
           c.name, c.url, c.airbnb_id, c.rating, c.review_count
    FROM snapshots_v2 sv
    JOIN competitors c ON c.id = sv.competitor_id
    WHERE c.comp_unit = ? AND sv.check_date = ? AND c.active = 1
    ORDER BY sv.tcpn ASC
  `).all(unit, date);

  return NextResponse.json({ success: true, data: rows });
}
