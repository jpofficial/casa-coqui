import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getPricingLib, getDb } from '@/lib/pricing-db';

const UNIT_SPECS = {
  'unit-a': { name: 'Unit A', bedrooms: 2, bathrooms: 1, sqft: 402 },
  'unit-b': { name: 'Unit B', bedrooms: 4, bathrooms: 1, sqft: 750 },
};

/**
 * POST /api/pricing/analyze
 * Run analysis for one or both units, regenerate report JSON, return data.
 *
 * Body: { days?: 30, unit?: "unit-a" | "unit-b" | "all" }
 */
export async function POST(request) {
  const { error } = await requireRole(request, ['admin']);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const days = body.days || 30;
  const unitParam = body.unit || 'all';
  const unitIds = unitParam === 'all' ? ['unit-a', 'unit-b'] : [unitParam];

  if (unitIds.some((u) => !['unit-a', 'unit-b'].includes(u))) {
    return NextResponse.json(
      { success: false, error: 'unit must be unit-a, unit-b, or all' },
      { status: 400 }
    );
  }

  const { db: dbLib, analysis, dates: datesLib } = getPricingLib();
  const db = getDb();

  const startDate = new Date().toISOString().split('T')[0];
  const dateRange = datesLib.generateDateRange(startDate, days);

  const units = {};
  for (const unitId of unitIds) {
    const comps = dbLib.getCompetitorsForUnit(unitId);
    const recommendations = analysis.analyzeUnit(unitId, dateRange);

    // Save to DB
    analysis.saveRecommendations(
      recommendations.map((r) => ({ ...r, unitId }))
    );

    const summary = analysis.getSummary(recommendations);

    // Build competitor summary
    const compSummary = comps.map((c) => {
      const snaps = db.prepare(
        'SELECT AVG(tcpn) as avg_tcpn, MAX(captured_at) as last_snapshot FROM snapshots WHERE competitor_id = ? AND available = 1'
      ).get(c.id);

      return {
        name: c.name,
        rating: c.rating,
        reviews: c.review_count,
        bedrooms: c.bedrooms,
        neighborhood: c.neighborhood,
        avgTcpn: snaps.avg_tcpn ? Math.round(snaps.avg_tcpn * 100) / 100 : null,
        lastSnapshot: snaps.last_snapshot ? snaps.last_snapshot.split('T')[0] : null,
      };
    });

    units[unitId] = {
      name: UNIT_SPECS[unitId]?.name || unitId,
      specs: UNIT_SPECS[unitId] || {},
      compCount: comps.length,
      summary,
      recommendations: recommendations
        .filter((r) => r.verdict !== 'insufficient_data')
        .map((r) => ({
          date: r.date,
          dayType: r.dayType,
          holiday: r.holiday,
          floor: r.floor,
          target: r.target,
          stretch: r.stretch,
          yourRate: r.yourRate,
          yourTcpn: r.yourTcpn,
          percentile: r.percentile,
          verdict: r.verdict,
          reasoning: r.reasoning,
          compCount: r.compCount,
          confidence: r.confidence,
          isBooked: r.isBooked || false,
          demandSignal: r.demandSignal || null,
          leadTimeDays: r.leadTimeDays,
          holidayAdjusted: r.holidayAdjusted || false,
        })),
      competitors: compSummary,
    };
  }

  const report = { generatedAt: new Date().toISOString(), units };

  dbLib.logAction('analysis_run_api', { units: unitIds, days });

  return NextResponse.json({ success: true, data: report });
}
