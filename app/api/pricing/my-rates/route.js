import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getPricingLib, getDb } from '@/lib/pricing-db';

/**
 * POST /api/pricing/my-rates
 * Batch upsert host rates.
 *
 * Body: {
 *   unit_id: "unit-a",
 *   cleaning_fee: 40,
 *   min_nights: 2,
 *   rates: [
 *     { date: "2026-04-04", rate: 65, booked: false },
 *     { date: "2026-04-05", rate: 70, booked: true },
 *   ]
 * }
 */
export async function POST(request) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const body = await request.json();
  const { unit_id, cleaning_fee = 0, min_nights = 2, rates } = body;

  if (!unit_id || !['unit-a', 'unit-b'].includes(unit_id)) {
    return NextResponse.json(
      { success: false, error: 'unit_id must be unit-a or unit-b' },
      { status: 400 }
    );
  }
  if (!Array.isArray(rates) || rates.length === 0) {
    return NextResponse.json(
      { success: false, error: 'rates array is required' },
      { status: 400 }
    );
  }

  const { db: dbLib, dates, normalize } = getPricingLib();
  const db = getDb();

  const results = db.transaction(() => {
    return rates.map((entry) => {
      const rate = parseFloat(entry.rate);
      const dayType = dates.classifyDayType(entry.date);
      const tcpn = normalize.computeTcpn(rate, cleaning_fee, min_nights);
      const booked = entry.booked ? 1 : 0;

      db.prepare(`
        INSERT INTO my_rates (unit_id, check_date, day_type, nightly_rate, cleaning_fee, tcpn, min_nights, is_booked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(unit_id, check_date) DO UPDATE SET
          day_type = excluded.day_type,
          nightly_rate = excluded.nightly_rate,
          cleaning_fee = excluded.cleaning_fee,
          tcpn = excluded.tcpn,
          min_nights = excluded.min_nights,
          is_booked = excluded.is_booked,
          captured_at = datetime('now')
      `).run(unit_id, entry.date, dayType, rate, cleaning_fee, tcpn, min_nights, booked);

      // Append to rate history for trend tracking
      try {
        db.prepare(`
          INSERT INTO my_rates_history (unit_id, check_date, nightly_rate, cleaning_fee, tcpn, is_booked)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(unit_id, entry.date, rate, cleaning_fee, tcpn, booked);
      } catch { /* history table may not exist yet */ }

      return { date: entry.date, dayType, rate, tcpn, booked };
    });
  })();

  dbLib.logAction('rate_update_api', { unit: unit_id, count: results.length });

  return NextResponse.json({ success: true, data: results });
}
