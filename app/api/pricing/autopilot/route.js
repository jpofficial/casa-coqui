import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getPricingLib, getDb } from '@/lib/pricing-db';

// Defense-in-depth: Next.js must NEVER evaluate this route at build time —
// it touches S3 via the pricing-db reader IAM user. Build-time eval was the
// trigger for the 2026-05-11 incident where the pricing key was overwritten
// and the build canary surfaced the regression. Force runtime evaluation.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult.error) return authResult.error;

  try {
    const db = getDb();
    const searchParams = new URL(request.url).searchParams;
    const unit = searchParams.get('unit') || 'unit-a';
    const days = parseInt(searchParams.get('days') || '30');

    const today = new Date().toISOString().split('T')[0];

    // Get recommendations_v2
    const recommendations = db.prepare(`
      SELECT * FROM recommendations_v2
      WHERE unit_id = ? AND check_date >= ?
      ORDER BY check_date ASC
      LIMIT ?
    `).all(unit, today, days);

    // Get latest autopilot run
    const lastRun = db.prepare(
      'SELECT * FROM autopilot_runs ORDER BY started_at DESC LIMIT 1'
    ).get() || null;

    // Get seasons
    const seasons = db.prepare('SELECT * FROM seasons ORDER BY start_month').all();

    return NextResponse.json({
      success: true,
      data: {
        recommendations: recommendations.map(r => ({
          date: r.check_date,
          dayType: r.day_type,
          season: r.season,
          recNightlyRate: r.rec_nightly_rate,
          recWeeklyPct: r.rec_weekly_pct,
          recMonthlyPct: r.rec_monthly_pct,
          floor: r.floor_price,
          target: r.target_price,
          stretch: r.stretch_price,
          yourRate: r.your_rate,
          yourTcpn: r.your_tcpn,
          percentile: r.percentile,
          verdict: r.verdict,
          reasoning: r.reasoning,
          confidence: r.confidence,
          compCount: r.comp_count,
          demandSignal: r.demand_signal,
          holidayAdjusted: r.holiday_adjusted === 1,
          generatedAt: r.generated_at,
        })),
        lastRun: lastRun ? {
          id: lastRun.id,
          runType: lastRun.run_type,
          status: lastRun.status,
          scrapeOk: lastRun.scrape_ok,
          scrapeErrors: lastRun.scrape_errors,
          analysisOk: lastRun.analysis_ok,
          durationMs: lastRun.duration_ms,
          startedAt: lastRun.started_at,
          completedAt: lastRun.completed_at,
        } : null,
        seasons,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult.error) return authResult.error;

  try {
    const db = getDb();
    const body = await request.json();
    const unit = body.unit || 'unit-a';
    const days = body.days || 30;

    // Import analysis modules via the CJS bridge
    const pricingLib = getPricingLib();
    const dates = pricingLib.dates;

    // Use the existing ESM bridge (lib/pricing-db.js) which already loads these CJS modules
    const { analyzeDateMultiStay } = pricingLib.multiStay;
    const dbHelpers = pricingLib.db;

    const today = new Date().toISOString().split('T')[0];
    const dateRange = dates.generateDateRange(today, days);

    // Build config snapshot
    const configSnapshot = { units: [unit], days, skipScrape: true };
    const rc = db.prepare('SELECT * FROM research_config WHERE comp_unit = ?').get(unit);
    if (rc) configSnapshot[unit] = { location: rc.location, minBedrooms: rc.min_bedrooms, maxBedrooms: rc.max_bedrooms };
    const compCount = db.prepare('SELECT COUNT(*) as n FROM competitors WHERE comp_unit = ? AND active = 1').get(unit);
    const compsActive = compCount ? compCount.n : 0;

    // Warnings collector
    const warnings = [];
    if (compsActive < 5) {
      warnings.push({ code: 'thin_data', unit, message: `Only ${compsActive} active comps` });
    }

    // Log run start
    const analyzeStartMs = Date.now();
    const runResult = db.prepare(
      `INSERT INTO autopilot_runs (run_type, units_processed, status, trigger, config_snapshot, comps_active)
       VALUES ('manual', ?, 'running', 'dashboard', ?, ?)`
    ).run(unit, JSON.stringify(configSnapshot), compsActive);
    const runId = runResult.lastInsertRowid;

    let analysisOk = 0;
    let insufficientCount = 0;
    const results = [];

    for (const date of dateRange) {
      try {
        const rec = analyzeDateMultiStay(db, unit, date);

        if (rec.verdict !== 'insufficient_data') {
          dbHelpers.saveRecommendationV2(db, {
            unitId: unit,
            checkDate: rec.date,
            dayType: rec.dayType,
            season: rec.season,
            tcpn_1n: rec.tcpn_1n,
            tcpn_2n: rec.tcpn_2n,
            tcpn_3n: rec.tcpn_3n,
            tcpn_4n: rec.tcpn_4n,
            tcpn_7n: rec.tcpn_7n,
            recNightlyRate: rec.recNightlyRate,
            recWeeklyPct: rec.recWeeklyPct,
            recMonthlyPct: rec.recMonthlyPct,
            floor: rec.floor,
            target: rec.target,
            stretch: rec.stretch,
            yourRate: rec.yourRate,
            yourTcpn: rec.yourTcpn,
            percentile: rec.percentile,
            verdict: rec.verdict,
            reasoning: rec.reasoning,
            confidence: rec.confidence,
            compCount: rec.compCount,
            demandSignal: rec.demandSignal,
            holidayAdjusted: rec.holidayAdjusted,
          }, runId);
          analysisOk++;
          results.push(rec);
        } else {
          insufficientCount++;
        }
      } catch { /* skip individual date errors */ }
    }

    const analyzeEndMs = Date.now();

    // Low confidence warning
    if (dateRange.length > 0 && insufficientCount / dateRange.length > 0.3) {
      warnings.push({ code: 'low_confidence', unit, message: `${insufficientCount}/${dateRange.length} dates had insufficient data` });
    }

    // Archive market data to history tables
    let historyRows = 0, availRows = 0;
    const archiveStartMs = Date.now();
    try {
      const scrapedAt = new Date().toISOString();
      const result = dbHelpers.archiveMarketData(db, unit, runId, scrapedAt);
      historyRows = result.historyRows;
      availRows = result.availRows;
    } catch { /* history tables may not exist yet */ }
    const archiveEndMs = Date.now();

    // Update run record with enriched metadata
    const startedRow = db.prepare('SELECT started_at FROM autopilot_runs WHERE id = ?').get(runId);
    db.prepare(`
      UPDATE autopilot_runs SET
        status = 'completed', analysis_ok = ?,
        duration_ms = ?, completed_at = datetime('now'),
        recs_written = ?, history_rows = ?, avail_rows = ?,
        warnings = ?,
        analyze_start_ms = ?, analyze_end_ms = ?,
        archive_start_ms = ?, archive_end_ms = ?
      WHERE id = ?
    `).run(
      analysisOk,
      Date.now() - Date.parse(startedRow.started_at),
      analysisOk, historyRows, availRows,
      warnings.length > 0 ? JSON.stringify(warnings) : null,
      analyzeStartMs, analyzeEndMs,
      archiveStartMs, archiveEndMs,
      runId
    );

    return NextResponse.json({
      success: true,
      data: {
        runId,
        analysisOk,
        recommendations: results.slice(0, 14).map(r => ({
          date: r.date,
          dayType: r.dayType,
          season: r.season,
          recNightlyRate: r.recNightlyRate,
          recWeeklyPct: r.recWeeklyPct,
          recMonthlyPct: r.recMonthlyPct,
          verdict: r.verdict,
          confidence: r.confidence,
        })),
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
