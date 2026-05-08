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
    const dateFrom = searchParams.get('dateFrom') || null;
    const dateTo = searchParams.get('dateTo') || null;

    const dbLib = getPricingLib().db;

    // ── Coverage mode: filter by date range ──
    if (dateFrom && dateTo) {
      const coverageMap = dbLib.getRunCoverageStats(db, dateFrom, dateTo);
      if (coverageMap.size === 0) {
        return NextResponse.json({
          success: true,
          data: { runs: [], total: 0, coverageMode: true },
        });
      }

      // Parse coverage keys into run IDs per source
      const autopilotIds = [];
      const researchIds = [];
      for (const key of coverageMap.keys()) {
        const [id, source] = key.split(':');
        if (source === 'autopilot') autopilotIds.push(Number(id));
        else if (source === 'research') researchIds.push(Number(id));
      }

      // Fetch matching runs from each table
      let autopilotRuns = [];
      if (autopilotIds.length > 0) {
        const placeholders = autopilotIds.map(() => '?').join(',');
        autopilotRuns = db.prepare(
          `SELECT * FROM run_summary WHERE id IN (${placeholders}) ORDER BY started_at DESC`
        ).all(...autopilotIds);
      }

      let researchRuns = [];
      if (researchIds.length > 0) {
        const placeholders = researchIds.map(() => '?').join(',');
        researchRuns = db.prepare(
          `SELECT * FROM research_runs WHERE id IN (${placeholders}) ORDER BY started_at DESC`
        ).all(...researchIds);
      }

      const rangeDays = Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1;
      const today = new Date().toISOString().split('T')[0];

      // Map + enrich with coverage stats
      function enrichRun(mapped, source, id) {
        const stats = coverageMap.get(`${id}:${source}`);
        if (!stats) return mapped;
        const freshnessDays = Math.max(0, Math.round((new Date(today) - new Date(mapped.startedAt)) / 86400000));
        const coverageRatio = rangeDays > 0 ? stats.datesCovered / rangeDays : 0;
        const compRatio = stats.uniqueComps > 0 ? Math.min(stats.uniqueComps / 10, 1) : 0;
        const freshnessFactor = Math.max(0, 1 - freshnessDays / 30);
        const score = coverageRatio * 0.5 + compRatio * 0.3 + freshnessFactor * 0.2;
        return {
          ...mapped,
          coverageStats: {
            obsInRange: stats.obsInRange,
            uniqueComps: stats.uniqueComps,
            datesCovered: stats.datesCovered,
            rangeDays,
            freshnessDays,
          },
          coverageScore: Math.round(score * 1000) / 1000,
        };
      }

      function getObsCounts(runId, runSource) {
        try {
          const row = db.prepare(`
            SELECT COUNT(*) as obs_count, COUNT(DISTINCT competitor_id) as listing_count
            FROM run_observations WHERE run_id = ? AND run_source = ?
          `).get(runId, runSource);
          return { obsCount: row?.obs_count || 0, listingCount: row?.listing_count || 0 };
        } catch { return { obsCount: 0, listingCount: 0 }; }
      }

      const mappedAutopilot = autopilotRuns.map(r => {
        const { obsCount, listingCount } = getObsCounts(r.id, 'autopilot');
        return enrichRun({
          id: r.id,
          source: 'autopilot',
          excluded: r.excluded || 0,
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
        }, 'autopilot', r.id);
      });

      const mappedResearch = researchRuns.map(r => {
        const { obsCount, listingCount } = getObsCounts(r.id, 'research');
        return enrichRun({
          id: r.id,
          source: 'research',
          excluded: r.excluded || 0,
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
        }, 'research', r.id);
      });

      const allRuns = [...mappedAutopilot, ...mappedResearch]
        .sort((a, b) => (b.coverageScore || 0) - (a.coverageScore || 0));

      // Mark top 2 non-excluded as recommended
      let recommended = 0;
      for (const run of allRuns) {
        if (!run.excluded && recommended < 2) {
          run.recommended = true;
          recommended++;
        }
      }

      return NextResponse.json({
        success: true,
        data: { runs: allRuns, total: allRuns.length, coverageMode: true },
      });
    }

    // ── Default mode: paginated chronological list ──
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
        excluded: r.excluded || 0,
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
          excluded: r.excluded || 0,
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
