import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb, getPricingLib } from '@/lib/pricing-db';
import { generateRateLede } from '@/lib/pricing-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function validUnit(s) {
  return s === 'unit-a' || s === 'unit-b';
}

export async function GET(request) {
  const authResult = await requireRole(request, ['admin', 'cohost']);
  if (authResult.error) return authResult.error;

  const url = new URL(request.url);
  const unit = url.searchParams.get('unit');
  const date = url.searchParams.get('date');

  if (!validUnit(unit)) {
    return NextResponse.json(
      { success: false, error: 'invalid unit' },
      { status: 400 }
    );
  }
  if (!validDate(date)) {
    return NextResponse.json(
      { success: false, error: 'invalid date (expected YYYY-MM-DD)' },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const { db: dbLib } = getPricingLib();

    const rec = dbLib.getRecommendationForDate(db, unit, date);
    const comps = dbLib.getCompBookedSummaryForDate(db, unit, date);
    const topComps = dbLib.getTopCompsForDate(db, unit, date, { stayNights: 2, limit: 5 });
    const latestRun = dbLib.getLatestRunMeta(db);

    if (!rec) {
      return NextResponse.json({
        success: true,
        data: {
          unit,
          date,
          has_data: false,
          lastRun: latestRun,
          topComps,
          compsSummary: comps,
        },
      });
    }

    // Lede cache: regenerate only if stale (or never generated).
    let lede = rec.lede_text;
    const stale =
      !rec.lede_generated_at ||
      (rec.generated_at && rec.lede_generated_at < rec.generated_at);
    if (!lede || stale) {
      lede = await generateRateLede({ rec, comps });
      db.prepare(
        `UPDATE recommendations_v2
         SET lede_text = ?, lede_generated_at = datetime('now')
         WHERE unit_id = ? AND check_date = ?`
      ).run(lede, unit, date);
    }

    // Parse reasoning JSON for optional factors (weekday multiplier, trend).
    let reasoning = {};
    if (rec.reasoning) {
      try {
        reasoning = JSON.parse(rec.reasoning);
      } catch {
        reasoning = {};
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        unit,
        date,
        has_data: true,
        rec_nightly_rate: rec.rec_nightly_rate,
        verdict: rec.verdict,
        confidence: rec.confidence,
        demand_signal: rec.demand_signal,
        day_type: rec.day_type,
        your_rate: rec.your_rate,
        tcpn_2n: rec.tcpn_2n,
        percentile: rec.percentile,
        reasoning,
        lede,
        compsSummary: comps,
        topComps,
        lastRun: latestRun,
      },
    });
  } catch (err) {
    console.error('[/api/pricing/calendar/day] error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'internal error' },
      { status: 500 }
    );
  }
}
