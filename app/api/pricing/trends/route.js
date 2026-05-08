import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/lib/pricing-db';

/**
 * GET /api/pricing/trends?unit=unit-a&days=30
 *
 * Returns historical market data for the Trends tab:
 * - market_history records grouped by check_date across runs
 * - availability trends
 * - computed insights (strengthening, softening, opportunities)
 */
export async function GET(request) {
  const { error } = await requireRole(request, ['admin', 'cohost']);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const unit = searchParams.get('unit') || 'unit-a';
  const days = parseInt(searchParams.get('days') || '30');

  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  // Get all history points for this unit with future check_dates
  const history = db.prepare(`
    SELECT * FROM market_history
    WHERE unit_id = ? AND check_date >= ?
    ORDER BY check_date ASC, scraped_at ASC
  `).all(unit, today);

  // Get runs within the requested timeframe
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const runs = db.prepare(`
    SELECT id, run_type, started_at, completed_at, status, analysis_ok
    FROM autopilot_runs
    WHERE started_at >= ? AND status = 'completed'
    ORDER BY started_at ASC
  `).all(cutoff);

  // Get availability log
  const comps = db.prepare('SELECT id, name FROM competitors WHERE comp_unit = ? AND active = 1').all(unit);
  const compIds = comps.map(c => c.id);
  let availHistory = [];
  if (compIds.length > 0) {
    const placeholders = compIds.map(() => '?').join(',');
    availHistory = db.prepare(`
      SELECT al.*, c.name as comp_name
      FROM availability_log al
      JOIN competitors c ON al.competitor_id = c.id
      WHERE al.competitor_id IN (${placeholders}) AND al.check_date >= ?
      ORDER BY al.check_date ASC, al.scraped_at ASC
    `).all(...compIds, today);
  }

  // Group history by check_date
  const byDate = {};
  for (const row of history) {
    if (!byDate[row.check_date]) byDate[row.check_date] = [];
    byDate[row.check_date].push({
      scraped_at: row.scraped_at,
      run_id: row.run_id,
      median_tcpn_2n: row.median_tcpn_2n,
      p25_tcpn_2n: row.p25_tcpn_2n,
      p75_tcpn_2n: row.p75_tcpn_2n,
      mean_nightly: row.mean_nightly,
      comp_count_total: row.comp_count_total,
      comp_count_avail: row.comp_count_avail,
      rec_nightly_rate: row.rec_nightly_rate,
      floor_price: row.floor_price,
      target_price: row.target_price,
      stretch_price: row.stretch_price,
      your_rate: row.your_rate,
      your_tcpn: row.your_tcpn,
      percentile: row.percentile,
      verdict: row.verdict,
      confidence: row.confidence,
      season: row.season,
      day_type: row.day_type,
      demand_signal: row.demand_signal,
    });
  }

  // Group availability by check_date → run
  const availByDate = {};
  for (const row of availHistory) {
    if (!availByDate[row.check_date]) availByDate[row.check_date] = {};
    const runKey = row.run_id;
    if (!availByDate[row.check_date][runKey]) {
      availByDate[row.check_date][runKey] = { scraped_at: row.scraped_at, total: 0, available: 0 };
    }
    availByDate[row.check_date][runKey].total++;
    if (row.available) availByDate[row.check_date][runKey].available++;
  }

  // Compute insights
  const insights = computeInsights(history, runs, availByDate, comps.length);

  // Compute comp movement (rate changes between last two runs)
  const compMovement = computeCompMovement(availHistory, runs, comps);

  return NextResponse.json({
    success: true,
    data: {
      unit,
      runs: runs.map(r => ({
        run_id: r.id,
        started_at: r.started_at,
        completed_at: r.completed_at,
        analysis_ok: r.analysis_ok,
      })),
      history: Object.entries(byDate).map(([date, points]) => ({
        check_date: date,
        points,
      })),
      availability: Object.entries(availByDate).map(([date, byRun]) => ({
        check_date: date,
        snapshots: Object.values(byRun),
      })),
      insights,
      compMovement,
      dataQuality: {
        totalRuns: runs.length,
        totalDataPoints: history.length,
        compCount: comps.length,
        oldestRun: runs[0]?.started_at || null,
        newestRun: runs[runs.length - 1]?.started_at || null,
      },
    },
  });
}

/**
 * Compute market insights from historical data.
 */
function computeInsights(history, runs, availByDate, compCount) {
  const insights = [];

  if (runs.length < 2) {
    insights.push({
      type: 'insufficient_data',
      message: 'Need at least 2 analysis runs to detect trends. Run the autopilot to start building history.',
      severity: 'info',
    });
    return insights;
  }

  // Get the last two runs
  const lastRun = runs[runs.length - 1];
  const prevRun = runs[runs.length - 2];

  const lastRunData = history.filter(h => h.run_id === lastRun.id);
  const prevRunData = history.filter(h => h.run_id === prevRun.id);

  if (lastRunData.length === 0 || prevRunData.length === 0) return insights;

  // Market direction: compare median TCPNs
  const lastMedians = lastRunData.filter(h => h.median_tcpn_2n).map(h => h.median_tcpn_2n);
  const prevMedians = prevRunData.filter(h => h.median_tcpn_2n).map(h => h.median_tcpn_2n);

  if (lastMedians.length > 0 && prevMedians.length > 0) {
    const lastAvg = lastMedians.reduce((a, b) => a + b, 0) / lastMedians.length;
    const prevAvg = prevMedians.reduce((a, b) => a + b, 0) / prevMedians.length;
    const pctChange = ((lastAvg - prevAvg) / prevAvg) * 100;

    if (Math.abs(pctChange) > 3) {
      const direction = pctChange > 0 ? 'strengthening' : 'softening';
      insights.push({
        type: direction,
        message: `Market ${direction === 'strengthening' ? 'rising' : 'falling'}: avg TCPN moved ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}% since last run`,
        severity: direction === 'strengthening' ? 'opportunity' : 'warning',
        delta: pctChange,
        lastAvg: Math.round(lastAvg),
        prevAvg: Math.round(prevAvg),
      });
    } else {
      insights.push({
        type: 'stable',
        message: `Market stable: avg TCPN changed ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%`,
        severity: 'info',
        delta: pctChange,
      });
    }
  }

  // Position shift
  const lastPercentiles = lastRunData.filter(h => h.percentile != null).map(h => h.percentile);
  const prevPercentiles = prevRunData.filter(h => h.percentile != null).map(h => h.percentile);

  if (lastPercentiles.length > 0 && prevPercentiles.length > 0) {
    const lastAvgP = lastPercentiles.reduce((a, b) => a + b, 0) / lastPercentiles.length;
    const prevAvgP = prevPercentiles.reduce((a, b) => a + b, 0) / prevPercentiles.length;
    const pShift = lastAvgP - prevAvgP;

    if (Math.abs(pShift) > 5) {
      insights.push({
        type: 'position_shift',
        message: `Your position: P${Math.round(lastAvgP)} (was P${Math.round(prevAvgP)})${pShift < 0 ? ' — you became more competitive' : ' — comps are undercutting you'}`,
        severity: pShift < 0 ? 'opportunity' : 'warning',
        currentPercentile: Math.round(lastAvgP),
        previousPercentile: Math.round(prevAvgP),
      });
    }
  }

  // Availability/demand signal
  const dates = Object.keys(availByDate);
  let totalTightening = 0;
  let totalDates = 0;
  for (const date of dates) {
    const snapshots = Object.values(availByDate[date]);
    if (snapshots.length < 2) continue;
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    if (first.total > 0 && last.total > 0) {
      const firstRate = first.available / first.total;
      const lastRate = last.available / last.total;
      if (lastRate < firstRate) totalTightening++;
      totalDates++;
    }
  }

  if (totalDates > 0) {
    const tighteningPct = (totalTightening / totalDates) * 100;
    if (tighteningPct > 60) {
      insights.push({
        type: 'demand_rising',
        message: `${totalTightening} of ${totalDates} dates show declining availability — demand is picking up`,
        severity: 'opportunity',
      });
    } else if (tighteningPct < 30) {
      insights.push({
        type: 'demand_soft',
        message: `Availability is holding steady across most dates — demand is soft`,
        severity: 'warning',
      });
    }
  }

  // Thin data warning
  if (compCount < 5) {
    insights.push({
      type: 'thin_data',
      message: `Only ${compCount} active competitors — consider adding more for reliable analysis`,
      severity: 'warning',
    });
  }

  return insights;
}

/**
 * Compute which competitors changed rates between the last two runs.
 */
function computeCompMovement(availHistory, runs, comps) {
  if (runs.length < 2) return [];

  const lastRun = runs[runs.length - 1];
  const prevRun = runs[runs.length - 2];

  const movements = [];

  for (const comp of comps) {
    const lastEntries = availHistory.filter(a => a.competitor_id === comp.id && a.run_id === lastRun.id);
    const prevEntries = availHistory.filter(a => a.competitor_id === comp.id && a.run_id === prevRun.id);

    if (lastEntries.length === 0 || prevEntries.length === 0) continue;

    // Compare average nightly rates
    const lastRates = lastEntries.filter(e => e.nightly_rate).map(e => e.nightly_rate);
    const prevRates = prevEntries.filter(e => e.nightly_rate).map(e => e.nightly_rate);

    if (lastRates.length === 0 || prevRates.length === 0) continue;

    const lastAvg = lastRates.reduce((a, b) => a + b, 0) / lastRates.length;
    const prevAvg = prevRates.reduce((a, b) => a + b, 0) / prevRates.length;
    const delta = lastAvg - prevAvg;
    const pctChange = (delta / prevAvg) * 100;

    if (Math.abs(pctChange) > 3) {
      movements.push({
        comp_id: comp.id,
        name: comp.name,
        direction: delta > 0 ? 'raised' : 'lowered',
        avgRate: Math.round(lastAvg),
        prevAvgRate: Math.round(prevAvg),
        delta: Math.round(delta),
        pctChange: pctChange.toFixed(1),
      });
    }
  }

  return movements.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
