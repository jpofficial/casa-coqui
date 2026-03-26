import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb, getPricingLib } from '@/lib/pricing-db';

export async function PATCH(request, { params }) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult.error) return authResult.error;

  try {
    const db = getDb();
    const { id } = await params;
    const body = await request.json();
    const { excluded, source = 'autopilot' } = body;

    if (excluded !== 0 && excluded !== 1) {
      return NextResponse.json({ success: false, error: 'excluded must be 0 or 1' }, { status: 400 });
    }

    const table = source === 'research' ? 'research_runs' : 'autopilot_runs';
    const result = db.prepare(`UPDATE ${table} SET excluded = ? WHERE id = ?`).run(excluded, Number(id));

    if (result.changes === 0) {
      return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: { id: Number(id), excluded } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET(request, { params }) {
  const authResult = await requireRole(request, ['admin', 'cohost']);
  if (authResult.error) return authResult.error;

  try {
    const db = getDb();
    const { id } = await params;
    const dbLib = getPricingLib().db;
    const searchParams = new URL(request.url).searchParams;
    const source = searchParams.get('source') || 'autopilot';
    const obsLimit = Math.min(parseInt(searchParams.get('obsLimit') || '200'), 1000);

    let run, configSnapshot, warnings, recsByUnit, marketSummary;

    if (source === 'research') {
      // Lookup from research_runs table
      run = db.prepare('SELECT * FROM research_runs WHERE id = ?').get(Number(id));
      if (!run) {
        return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
      }
      configSnapshot = run.config_snapshot ? JSON.parse(run.config_snapshot) : null;
      warnings = [];
      recsByUnit = {};
      marketSummary = [];
    } else {
      // Autopilot run — use existing run_summary view
      run = dbLib.getRunById(db, Number(id));
      if (!run) {
        return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
      }
      configSnapshot = run.config_snapshot ? JSON.parse(run.config_snapshot) : null;
      warnings = run.warnings ? JSON.parse(run.warnings) : [];

      const units = (run.units_processed || '').split(',').filter(Boolean);
      recsByUnit = {};
      for (const uid of units) {
        recsByUnit[uid] = dbLib.getRunRecSummary(db, run.id, uid);
      }
      marketSummary = dbLib.getRunMarketSummary(db, run.id);
    }

    // Layer 2: listings summary + raw observations
    let listingsSummary = [];
    let observations = [];
    let obsTotal = 0;
    let comparison = null;

    try {
      listingsSummary = dbLib.getRunListingsSummary(db, Number(id), source);
      observations = dbLib.getRunObservations(db, Number(id), source, obsLimit);
      const countRow = db.prepare(
        'SELECT COUNT(*) as total FROM run_observations WHERE run_id = ? AND run_source = ?'
      ).get(Number(id), source);
      obsTotal = countRow ? countRow.total : observations.length;
    } catch { /* run_observations table may not exist for old runs */ }

    // Run comparison (autopilot only)
    if (source === 'autopilot') {
      try {
        comparison = dbLib.getRunComparison(db, Number(id));
      } catch { /* may fail for old runs without market_history */ }
    }

    // Calendar availability summary (research runs with calendar capture)
    let calendarSummary = [];
    let calendarWindow = null;
    if (source === 'research') {
      try {
        calendarSummary = dbLib.getCalendarSummary(db, Number(id), 'research');
        if (run.calendar_start_date || run.calendar_end_date) {
          calendarWindow = { start: run.calendar_start_date, end: run.calendar_end_date };
        }
      } catch { /* table may not exist for old runs */ }
    }

    // Build response — normalize field names for both run types
    const runData = source === 'research' ? {
      id: run.id,
      source: 'research',
      trigger: 'research',
      runType: 'research',
      status: run.status,
      units: run.comp_unit,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      durationMs: run.duration_ms,
      scrapeOk: run.listings_saved || 0,
      scrapeErrors: run.errors || 0,
      analysisOk: 0,
      compsFound: run.listings_found || 0,
      compsActive: run.listings_saved || 0,
      errorLog: run.error_log || null,
      phaseDurations: { scrape: run.duration_ms || null, analyze: null, archive: null },
    } : {
      id: run.id,
      source: 'autopilot',
      trigger: run.trigger || 'terminal',
      runType: run.run_type,
      status: run.status,
      units: run.units_processed,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      durationMs: run.duration_ms,
      scrapeOk: run.scrape_ok,
      scrapeErrors: run.scrape_errors,
      analysisOk: run.analysis_ok,
      recsWritten: run.recs_written,
      compsFound: run.comps_found,
      compsActive: run.comps_active,
      historyRows: run.history_rows,
      availRows: run.avail_rows,
      errorLog: run.error_log || null,
      phaseDurations: {
        scrape: run.scrape_duration_ms || null,
        analyze: run.analyze_duration_ms || null,
        archive: run.archive_duration_ms || null,
      },
    };

    return NextResponse.json({
      success: true,
      data: {
        run: runData,
        configSnapshot,
        warnings,
        recsByUnit,
        marketSummary: (marketSummary || []).map(m => ({
          unitId: m.unit_id,
          datesCovered: m.dates_covered,
          avgMedianTcpn: m.avg_median_tcpn,
          avgCompsAvailable: m.avg_comps_available,
          avgPercentile: m.avg_percentile,
        })),
        listingsSummary: listingsSummary.map(l => ({
          competitorId: l.competitor_id,
          airbnbId: l.airbnb_id,
          name: l.listing_name,
          url: l.listing_url,
          compUnit: l.comp_unit,
          bedrooms: l.bedrooms,
          bathrooms: l.bathrooms,
          rating: l.rating,
          reviewCount: l.review_count,
          superhost: l.superhost,
          obsCount: l.obs_count,
          stayLengths: l.stay_lengths,
          avgRate: l.avg_rate,
          minRate: l.min_rate,
          maxRate: l.max_rate,
          avgTcpn: l.avg_tcpn,
        })),
        observations: observations.map(o => ({
          competitorId: o.competitor_id,
          airbnbId: o.airbnb_id,
          listingName: o.listing_name,
          compUnit: o.comp_unit,
          checkDate: o.check_date,
          stayNights: o.stay_nights,
          nightlyRate: o.nightly_rate,
          cleaningFee: o.cleaning_fee,
          totalCost: o.total_cost,
          tcpn: o.tcpn,
          available: o.available,
        })),
        obsTotal,
        obsTruncated: obsTotal > observations.length,
        comparison,
        calendarSummary: calendarSummary.map(c => ({
          competitorId: c.competitor_id,
          airbnbId: c.airbnb_id,
          listingName: c.listing_name,
          month: c.month,
          availableNights: c.available_nights,
          notAvailableNights: c.not_available_nights,
          weekendNotAvailableNights: c.weekend_not_available_nights,
        })),
        calendarWindow,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
