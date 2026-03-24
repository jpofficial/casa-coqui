import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getPricingLib, getDb } from '@/lib/pricing-db';

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

/**
 * POST /api/pricing/snapshots
 * Batch upsert competitor rate snapshots.
 *
 * Body: {
 *   unit: "unit-a",
 *   snapshots: [
 *     { competitor_id: 1, date: "2026-04-04", rate: 72, available: true },
 *     { competitor_id: 1, date: "2026-04-05", rate: 0, available: false },
 *   ]
 * }
 */
export async function POST(request) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const body = await request.json();
  const { snapshots } = body;

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return NextResponse.json(
      { success: false, error: 'snapshots array is required' },
      { status: 400 }
    );
  }

  const { db: dbLib, dates, normalize } = getPricingLib();
  const db = getDb();

  const results = db.transaction(() => {
    return snapshots.map((s) => {
      const comp = dbLib.getCompetitor(s.competitor_id);
      if (!comp) return { error: `Competitor #${s.competitor_id} not found`, date: s.date };

      const rate = parseFloat(s.rate || 0);
      const available = s.available !== false && rate > 0 ? 1 : 0;
      const cleaningFee = s.cleaning_fee != null ? parseFloat(s.cleaning_fee) : comp.cleaning_fee;
      const assumedNights = s.assumed_nights || 2;
      const dayType = dates.classifyDayType(s.date);
      const totalCost = available ? normalize.computeTotalCost(rate, cleaningFee, assumedNights) : null;
      const tcpn = available ? normalize.computeTcpn(rate, cleaningFee, assumedNights) : null;

      db.prepare(`
        INSERT INTO snapshots (competitor_id, check_date, day_type, nightly_rate, cleaning_fee,
          total_cost, tcpn, assumed_nights, available)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(competitor_id, check_date) DO UPDATE SET
          day_type = excluded.day_type,
          nightly_rate = excluded.nightly_rate,
          cleaning_fee = excluded.cleaning_fee,
          total_cost = excluded.total_cost,
          tcpn = excluded.tcpn,
          assumed_nights = excluded.assumed_nights,
          available = excluded.available,
          captured_at = datetime('now')
      `).run(comp.id, s.date, dayType, rate, cleaningFee, totalCost, tcpn, assumedNights, available);

      return { date: s.date, competitor_id: comp.id, dayType, rate, tcpn, available };
    });
  })();

  dbLib.logAction('snapshot_batch_api', { count: results.length });

  return NextResponse.json({ success: true, data: results });
}
