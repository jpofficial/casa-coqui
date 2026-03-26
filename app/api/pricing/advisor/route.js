import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb } from '@/lib/pricing-db';
import { generatePricingAdvice, chatWithAdvisor } from '@/lib/pricing-ai';

export async function POST(request) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult.error) return authResult.error;

  try {
    const body = await request.json();
    const { unit = 'unit-a', message, context } = body;

    // Follow-up chat message
    if (message && context) {
      const result = await chatWithAdvisor({
        dataMessage: context.dataMessage,
        toolUseId: context.toolUseId,
        initialAdvice: context.initialAdvice,
        followUps: context.followUps || [],
        userMessage: message,
      });
      return NextResponse.json({ success: true, data: result });
    }

    // Initial report generation
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];

    const recommendations = db.prepare(`
      SELECT * FROM recommendations_v2
      WHERE unit_id = ? AND check_date >= ?
      ORDER BY check_date ASC
      LIMIT 30
    `).all(unit, today);

    if (recommendations.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No autopilot data available. Run the analysis first.',
      }, { status: 400 });
    }

    const competitors = db.prepare(
      'SELECT * FROM competitors WHERE comp_unit = ? AND active = 1'
    ).all(unit);

    const seasons = db.prepare('SELECT * FROM seasons ORDER BY start_month').all();

    // Fetch trend data for enhanced AI context
    let trendData = null;
    try {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      const runs = db.prepare(`
        SELECT id, started_at, completed_at, status, analysis_ok
        FROM autopilot_runs WHERE started_at >= ? AND status = 'completed'
        ORDER BY started_at ASC
      `).all(cutoff);

      if (runs.length >= 2) {
        const history = db.prepare(`
          SELECT * FROM market_history WHERE unit_id = ? AND check_date >= ?
          ORDER BY check_date ASC, scraped_at ASC
        `).all(unit, today);

        // Compute basic insights inline
        const lastRun = runs[runs.length - 1];
        const prevRun = runs[runs.length - 2];
        const lastData = history.filter(h => h.run_id === lastRun.id);
        const prevData = history.filter(h => h.run_id === prevRun.id);

        const insights = [];
        const lastMedians = lastData.filter(h => h.median_tcpn_2n).map(h => h.median_tcpn_2n);
        const prevMedians = prevData.filter(h => h.median_tcpn_2n).map(h => h.median_tcpn_2n);

        if (lastMedians.length > 0 && prevMedians.length > 0) {
          const lastAvg = lastMedians.reduce((a, b) => a + b, 0) / lastMedians.length;
          const prevAvg = prevMedians.reduce((a, b) => a + b, 0) / prevMedians.length;
          const delta = ((lastAvg - prevAvg) / prevAvg) * 100;
          insights.push({
            type: delta > 3 ? 'strengthening' : delta < -3 ? 'softening' : 'stable',
            message: `Market TCPN moved ${delta > 0 ? '+' : ''}${delta.toFixed(1)}% since last run`,
            severity: delta > 3 ? 'opportunity' : delta < -3 ? 'warning' : 'info',
            delta,
          });
        }

        // Comp movement
        const compIds = competitors.map(c => c.id);
        if (compIds.length > 0) {
          const placeholders = compIds.map(() => '?').join(',');
          const availHistory = db.prepare(`
            SELECT al.*, c.name as comp_name FROM availability_log al
            JOIN competitors c ON al.competitor_id = c.id
            WHERE al.competitor_id IN (${placeholders}) AND al.check_date >= ?
          `).all(...compIds, today);

          const compMovement = [];
          for (const comp of competitors) {
            const lastEntries = availHistory.filter(a => a.competitor_id === comp.id && a.run_id === lastRun.id);
            const prevEntries = availHistory.filter(a => a.competitor_id === comp.id && a.run_id === prevRun.id);
            if (lastEntries.length === 0 || prevEntries.length === 0) continue;
            const lastRates = lastEntries.filter(e => e.nightly_rate).map(e => e.nightly_rate);
            const prevRates = prevEntries.filter(e => e.nightly_rate).map(e => e.nightly_rate);
            if (lastRates.length === 0 || prevRates.length === 0) continue;
            const lastAvgR = lastRates.reduce((a, b) => a + b, 0) / lastRates.length;
            const prevAvgR = prevRates.reduce((a, b) => a + b, 0) / prevRates.length;
            const d = lastAvgR - prevAvgR;
            const pct = (d / prevAvgR) * 100;
            if (Math.abs(pct) > 3) {
              compMovement.push({ name: comp.name, direction: d > 0 ? 'raised' : 'lowered', delta: Math.round(d), pctChange: pct.toFixed(1) });
            }
          }

          trendData = {
            insights,
            compMovement,
            dataQuality: { totalDataPoints: history.length, totalRuns: runs.length, newestRun: lastRun.started_at },
          };
        }
      }
    } catch { /* trend data is optional — don't fail the advisor if history tables don't exist */ }

    const result = await generatePricingAdvice({
      recommendations,
      competitors,
      seasons,
      unit,
      trendData,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[pricing/advisor] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to generate recommendation' },
      { status: 500 }
    );
  }
}
