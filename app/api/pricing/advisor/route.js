import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb, getPricingLib } from '@/lib/pricing-db';
import { generatePricingAdvice, chatWithAdvisor } from '@/lib/pricing-ai';

export async function POST(request) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult.error) return authResult.error;

  try {
    const body = await request.json();
    const { unit = 'unit-a', message, context } = body;

    // Follow-up chat message (locked down: text only, no tool regeneration)
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

    // -----------------------------------------------------------------
    // Initial report generation — 3-layer architecture
    // -----------------------------------------------------------------
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];

    // 1. Check we have data
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

    // Competitor timeline evidence (cross-run price movement + availability)
    const { compTimeline } = getPricingLib();
    let evidence = null;
    try {
      evidence = compTimeline.getMarketMovementSummary(db, unit);
    } catch { /* timeline data may not exist yet */ }

    // 2. Layer 1+2: Build decisions from pre-computed recommendations
    // The analysis pipeline (autopilot) already computed comp counts, TCPNs,
    // floor/target/stretch, confidence, etc. We apply the decision matrix on
    // top rather than re-running analyzeDateMultiStay from sparse snapshots.
    const { stats, availability, decisionEngine, dates: dateUtils } = getPricingLib();
    const trend = decisionEngine.classifyMarketTrend(db, unit);

    // Count recent runs for confidence model
    const cutoff30d = new Date(Date.now() - 30 * 86400000).toISOString();
    let runCount = 1;
    try {
      const rc = db.prepare(
        "SELECT COUNT(*) as cnt FROM autopilot_runs WHERE started_at >= ? AND status = 'completed'"
      ).get(cutoff30d);
      runCount = rc?.cnt || 1;
    } catch { /* autopilot_runs may not exist */ }

    const decisions = recommendations.map(rec => {
      try {
        const todayMs = new Date().setHours(0, 0, 0, 0);
        const checkMs = new Date(rec.check_date + 'T12:00:00').getTime();
        const leadTimeDays = Math.max(0, Math.round((checkMs - todayMs) / 86400000));

        // Data freshness from when the recommendation was generated
        const generatedAt = rec.generated_at ? new Date(rec.generated_at).getTime() : 0;
        const dataAgeDays = generatedAt ? (Date.now() - generatedAt) / 86400000 : 999;

        // Holiday + day of week from date
        const holiday = dateUtils.isHoliday(rec.check_date);
        const dayOfWeek = rec.day_type || dateUtils.getDayOfWeek(rec.check_date);

        // Availability signal from calendar_availability (live query)
        const availResult = availability.classifyAvailability(db, unit, rec.check_date);

        // Confidence from pre-computed data + live factors
        const confidenceResult = stats.computeConfidence({
          compCount: rec.comp_count || 0,
          dataAgeDays,
          tcpnCV: 0.15, // moderate spread assumption for pre-computed data
          runCount,
          signalsAgree: true,
          leadTimeDays,
        });

        // Determine anchor TCPN (2n preferred, fall back through chain)
        const anchorTcpn = rec.tcpn_2n || rec.tcpn_3n || rec.tcpn_1n || rec.tcpn_4n || rec.tcpn_7n;
        const anchorNights = rec.tcpn_2n ? 2 : rec.tcpn_3n ? 3 : rec.tcpn_1n ? 1 : rec.tcpn_4n ? 4 : rec.tcpn_7n ? 7 : 2;

        // My rate from recommendation or my_rates table
        const myRateRow = db.prepare('SELECT * FROM my_rates WHERE unit_id = ? AND check_date = ?').get(unit, rec.check_date);
        const currentRate = myRateRow?.nightly_rate || rec.your_rate || null;
        const isBooked = myRateRow?.is_booked === 1;
        const cleaningFee = myRateRow?.cleaning_fee || 75;

        // Build percentile from pre-computed data
        const pctRank = rec.percentile;

        // Decision matrix on pre-computed position
        const decision = decisionEngine.applyDecisionMatrix(
          pctRank,
          trend.direction,
          availResult.signal,
          confidenceResult.score
        );

        // Compute suggested rate using full multiplier stack (if we have TCPN data)
        let suggestedRate = rec.rec_nightly_rate;
        let multipliers = null;
        let baseRate = null;

        if (anchorTcpn && decision.action !== 'suppress') {
          const rateResult = decisionEngine.computeSuggestedRate({
            anchorTcpn,
            anchorNights,
            cleaningFee,
            dayOfWeek,
            seasonName: rec.season || 'shoulder',
            leadTimeDays,
            trendDeltaPct: trend.deltaPct,
            availSignal: availResult.signal,
            holiday,
            freshData: dataAgeDays <= 3,
            floorRate: rec.floor_price,
            stretchRate: rec.stretch_price,
          });
          suggestedRate = rateResult.suggestedRate;
          multipliers = rateResult.multipliers;
          baseRate = rateResult.baseRate;
        }

        // Apply guardrails
        const guardrailResult = (suggestedRate && decision.action !== 'suppress')
          ? decisionEngine.applyGuardrails(
              decision.action, suggestedRate, currentRate,
              leadTimeDays, rec.floor_price, isBooked
            )
          : { finalRate: currentRate || suggestedRate, action: decision.action === 'suppress' ? 'suppress' : 'hold', delta: 0, deltaPct: 0, guardrailApplied: null };

        // Generate warnings
        const warnings = stats.generateWarnings({
          compCount: rec.comp_count || 0,
          dataAgeDays,
          confidenceTier: confidenceResult.tier,
          runCount,
          signalsAgree: decisionEngine.checkSignalAgreement(decision.action, trend.direction, availResult.signal),
        });

        return {
          action: guardrailResult.action,
          suggestedRate: guardrailResult.finalRate,
          currentRate,
          delta: guardrailResult.delta,
          deltaPct: guardrailResult.deltaPct,
          guardrailApplied: guardrailResult.guardrailApplied,
          floor: rec.floor_price,
          target: rec.target_price,
          stretch: rec.stretch_price,
          percentile: pctRank,
          decisionReason: decision.reason,
          marketTrend: trend.direction || 'stable',
          trendDeltaPct: trend.deltaPct,
          availabilitySignal: availResult.signal || 'unknown',
          unavailablePct: availResult.unavailablePct,
          confidence: confidenceResult.tier,
          confidenceScore: confidenceResult.score,
          confidenceFactors: confidenceResult.factors,
          season: rec.season,
          dayOfWeek,
          holiday: holiday ? holiday.name : null,
          leadTimeDays,
          isBooked,
          compCount: rec.comp_count || 0,
          dataAgeDays: Math.round(dataAgeDays * 10) / 10,
          multipliers,
          baseRate,
          warnings,
          date: rec.check_date,
          recWeeklyPct: rec.rec_weekly_pct,
          recMonthlyPct: rec.rec_monthly_pct,
        };
      } catch (err) {
        console.error(`[advisor] Decision engine error for ${rec.check_date}:`, err.message);
        return {
          action: 'hold',
          suggestedRate: rec.rec_nightly_rate || null,
          currentRate: rec.your_rate || null,
          confidence: 'low',
          confidenceScore: 0,
          warnings: [{ code: 'engine_error', severity: 'critical', message: err.message }],
          date: rec.check_date,
          isBooked: false,
          compCount: rec.comp_count || 0,
          floor: rec.floor_price,
          target: rec.target_price,
          stretch: rec.stretch_price,
          season: rec.season,
          recWeeklyPct: rec.rec_weekly_pct,
          recMonthlyPct: rec.rec_monthly_pct,
        };
      }
    });

    // 3. Aggregate summary
    const summary = decisionEngine.summarizeDecisions(decisions);

    // 4. Layer 3: AI explains the pre-computed recommendation
    const result = await generatePricingAdvice({
      summary,
      decisions,
      competitors,
      unit,
      evidence,
    });

    // Add backward-compat fields for existing dashboard (will be removed in Phase 3 UI redesign)
    if (result.advice) {
      const a = result.advice;
      if (!a.summary) a.summary = a.explanation || '';
      if (!a.weekdayRate) a.weekdayRate = a.suggestedRate;
      if (!a.weekendRate) a.weekendRate = a.suggestedRate ? Math.round(a.suggestedRate * 1.08 / 5) * 5 : null;
      if (!a.weeklyDiscount) a.weeklyDiscount = a.weeklyDiscountPct;
      if (!a.monthlyDiscount) a.monthlyDiscount = a.monthlyDiscountPct;
      if (!a.actions) a.actions = (Array.isArray(a.opportunities) ? a.opportunities : []).map(o => o.text);
      if (!a.alerts) a.alerts = (Array.isArray(a.cautions) ? a.cautions : []).map(c => c.text);
      if (!a.dailyRates) a.dailyRates = [];
    }

    // 5. Write to advisor_log
    try {
      db.prepare(`
        INSERT INTO advisor_log (unit_id, action, suggested_rate, current_rate, confidence, confidence_score, market_trend, availability_signal, percentile, comp_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        unit,
        summary.action,
        summary.suggestedRate || 0,
        summary.currentRate || 0,
        summary.confidence,
        summary.confidenceScore,
        summary.marketTrend || null,
        summary.availabilitySignal || null,
        summary.avgPercentile || null,
        summary.compCount || 0,
      );
    } catch { /* advisor_log table may not exist yet */ }

    // 6. Aggregate confidence factors across non-suppressed decisions
    const activeDecisions = decisions.filter(d => d.action !== 'suppress' && !d.isBooked && d.confidenceFactors);
    let confidenceFactors = null;
    if (activeDecisions.length > 0) {
      const factorKeys = Object.keys(activeDecisions[0].confidenceFactors);
      confidenceFactors = {};
      for (const key of factorKeys) {
        const values = activeDecisions.map(d => d.confidenceFactors[key]).filter(v => v != null);
        confidenceFactors[key] = values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0;
      }
    }

    // 7. Extract representative multiplier data from first non-suppressed, non-booked decision
    let multiplierData = null;
    const repDecision = decisions.find(d => d.action !== 'suppress' && !d.isBooked && d.multipliers);
    if (repDecision) {
      multiplierData = {
        baseRate: repDecision.baseRate,
        multipliers: repDecision.multipliers,
        finalRate: repDecision.suggestedRate,
      };
    }

    return NextResponse.json({ success: true, data: { ...result, evidence, confidenceFactors, multiplierData } });
  } catch (err) {
    console.error('[pricing/advisor] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to generate recommendation' },
      { status: 500 }
    );
  }
}
