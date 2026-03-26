import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb, getPricingLib } from '@/lib/pricing-db';

export async function GET(request) {
  const authResult = await requireRole(request, ['admin', 'cohost']);
  if (authResult.error) return authResult.error;

  try {
    const db = getDb();
    const searchParams = new URL(request.url).searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status') || null;

    const dbLib = getPricingLib().db;

    // Overfetch both sources so merge+slice produces correct page
    const fetchLimit = limit + offset;
    const { runs: autopilotRuns, total: autopilotTotal } = dbLib.getRunList(db, { limit: fetchLimit, offset: 0, status });
    const { runs: researchRuns, total: researchTotal } = dbLib.getResearchRuns(db, { limit: fetchLimit, offset: 0, status });

    // Get obs counts per run from run_observations
    function getObsCounts(runId, runSource) {
      try {
        const row = db.prepare(`
          SELECT COUNT(*) as obs_count, COUNT(DISTINCT competitor_id) as listing_count
          FROM run_observations WHERE run_id = ? AND run_source = ?
        `).get(runId, runSource);
        return { obsCount: row?.obs_count || 0, listingCount: row?.listing_count || 0 };
      } catch { return { obsCount: 0, listingCount: 0 }; }
    }

    // Map autopilot runs
    const mappedAutopilot = autopilotRuns.map(r => {
      const { obsCount, listingCount } = getObsCounts(r.id, 'autopilot');
      return {
        id: r.id,
        source: 'autopilot',
        trigger: r.trigger || 'terminal',
        runType: r.run_type,
        status: r.status,
        units: r.units_processed,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        durationMs: r.duration_ms,
        scrapeOk: r.scrape_ok,
        scrapeErrors: r.scrape_errors,
        analysisOk: r.analysis_ok,
        recsWritten: r.recs_written,
        compsFound: r.comps_found,
        compsActive: r.comps_active,
        historyRows: r.history_rows,
        availRows: r.avail_rows,
        warningCount: r.warnings ? JSON.parse(r.warnings).length : 0,
        errorLog: r.error_log || null,
        obsCount,
        listingCount,
        phaseDurations: {
          scrape: r.scrape_duration_ms || null,
          analyze: r.analyze_duration_ms || null,
          archive: r.archive_duration_ms || null,
        },
      };
    });

    // Map research runs to same shape (status already filtered at DB level)
    const mappedResearch = researchRuns.map(r => {
        const { obsCount, listingCount } = getObsCounts(r.id, 'research');
        return {
          id: r.id,
          source: 'research',
          trigger: 'research',
          runType: 'research',
          status: r.status,
          units: r.comp_unit,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          durationMs: r.duration_ms,
          scrapeOk: r.listings_saved || 0,
          scrapeErrors: r.errors || 0,
          analysisOk: 0,
          recsWritten: 0,
          compsFound: r.listings_found || 0,
          compsActive: r.listings_saved || 0,
          historyRows: 0,
          availRows: 0,
          warningCount: 0,
          errorLog: r.error_log || null,
          obsCount,
          listingCount,
          phaseDurations: { scrape: r.duration_ms || null, analyze: null, archive: null },
        };
      });

    // Merge, sort, and slice to correct page window
    const allRuns = [...mappedAutopilot, ...mappedResearch]
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      data: {
        runs: allRuns,
        total: autopilotTotal + researchTotal,
        limit,
        offset,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
