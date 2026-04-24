import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb, getPricingLib } from '@/lib/pricing-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validMonth(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
}

function validUnit(s) {
  return s === 'unit-a' || s === 'unit-b';
}

export async function GET(request) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult.error) return authResult.error;

  const url = new URL(request.url);
  const unit = url.searchParams.get('unit');
  const month = url.searchParams.get('month');

  if (!validUnit(unit)) {
    return NextResponse.json(
      { success: false, error: 'invalid unit' },
      { status: 400 }
    );
  }
  if (!validMonth(month)) {
    return NextResponse.json(
      { success: false, error: 'invalid month (expected YYYY-MM)' },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const { db: dbLib } = getPricingLib();

    const rows = dbLib.getRecommendationsForMonth(db, unit, month);
    const latestRun = dbLib.getLatestRunMeta(db);
    const compSet = dbLib.getCompSetSummaryForUnit(db, unit);

    const days = rows.map((r) => ({
      date: r.check_date,
      rec_nightly_rate: r.rec_nightly_rate,
      verdict: r.verdict,
      confidence: r.confidence,
      demand_signal: r.demand_signal,
      day_type: r.day_type,
      has_data: r.rec_nightly_rate != null,
    }));

    return NextResponse.json({
      success: true,
      data: { unit, month, days, lastRun: latestRun, compSet },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
