import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-auth';
import { getDb, getPricingLib } from '@/lib/pricing-db';
import { generatePricingAdvice, chatWithAdvisor, answerEvidenceQuestion } from '@/lib/pricing-ai';
import {
  gatherAvailabilityEvidence,
  gatherCompetitorPricingEvidence,
  gatherRunDetailEvidence,
  gatherMarketTrendEvidence,
  gatherDataCoverageEvidence,
  gatherRunsForMonthEvidence,
  gatherComparisonEvidence,
  gatherCheapestByStayLength,
  gatherBookedVsAvailableEvidence,
} from '@/lib/pricing-evidence';

// Evidence gathering + Anthropic call can take 5-30s. Default Vercel
// function timeout (10s on Hobby) cuts the response off mid-stream and
// the browser sees "unexpected end of JSON input".
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Evidence intent detection (deterministic, no LLM call)
//
// Order matters: more specific patterns are checked first to avoid
// broad patterns (e.g. "availability") swallowing compound queries
// (e.g. "compare pricing and availability").
// ---------------------------------------------------------------------------

const EVIDENCE_INTENTS = [
  { pattern: /\brun\s*#?\d+|run\s+id\s+\d+|specific\s+run|last\s+run|previous\s+run|latest\s+run/i, handler: 'runDetail' },
  // runsForMonth requires explicit "run(s)" keyword — prevents "for april" from hijacking other intents
  { pattern: /\bruns?\b.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}-\d{2})\b|\bruns?\s+(for|in|from|during)\b/i, handler: 'runsForMonth' },
  { pattern: /\bcheapest|\bmost\s+affordable|\bbest\s+deal|\bbudget|\b(lowest|low)\s+(price|priced|rate|comp|listing|property|cost)|\bwho.?s\s+(cheapest|lowest)/i, handler: 'cheapest' },
  { pattern: /\bwho.*getting\s+booked|\bbooked\s+vs|\bwhy\s+not\s+booking|\bwho.*booking|\bactually.*booked/i, handler: 'bookedAnalysis' },
  { pattern: /\bcompare|\bcomparison|\bvs\b|\bversus|\bagainst|\bcross.?comp|\brankings?\b/i, handler: 'comparison' },
  { pattern: /\bcompet.*pric|\bprice.*compet|\brate.*compet|\bcompet.*rate|\bwho.*raised|\bwho.*lower|\bprice\s+mov/i, handler: 'competitorPricing' },
  { pattern: /\bunavail|\bavailab|\bbooked|\boccupan/i, handler: 'availability' },
  { pattern: /\btrend|\bmarket.*direction|\bmarket.*mov|\bhow.*market|\bstrength|\bsoften/i, handler: 'marketTrend' },
  { pattern: /\bgap|\bcoverage|\bmissing|\bthin\s+data|\bdata\s+quality/i, handler: 'dataCoverage' },
];

function detectIntent(query) {
  for (const intent of EVIDENCE_INTENTS) {
    if (intent.pattern.test(query)) return intent;
  }
  return { handler: 'general' };
}

/** Extract a run ID from a query string, e.g. "run #42" or "run 7". */
function extractRunId(query) {
  const match = query.match(/run\s*#?(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

/**
 * Extract a date range from a query string.
 * Recognizes: "for April", "in March", "month of May", "2026-04".
 * Returns { dateFrom, dateTo } or null if no month/date found.
 */
function extractDateRange(query) {
  const month = extractMonth(query);
  if (!month) return null;
  const [y, m] = month.split('-').map(Number);
  const dateFrom = `${month}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { dateFrom, dateTo: nextMonth };
}

/** Extract a stay length from a query string, e.g. "3-night", "for 7 nights". Default: 2. */
function extractStayNights(query) {
  const match = query.match(/(\d+)\s*-?\s*nights?/i);
  return match ? parseInt(match[1]) : 2;
}

/** Extract a month from a query string, e.g. "April", "2026-04", "04", "4". */
function extractMonth(query) {
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  // YYYY-MM format
  const isoMatch = query.match(/\b(20\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  // Month name (full or abbreviated)
  const nameMatch = query.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  if (nameMatch) {
    const key = nameMatch[1].substring(0, 3).toLowerCase();
    const year = new Date().getFullYear();
    return `${year}-${months[key]}`;
  }
  // Numeric month only, e.g. "04" or "4"
  const numMatch = query.match(/\bmonth\s+(\d{1,2})\b/i) || query.match(/\b(\d{1,2})\b/);
  if (numMatch) {
    const m = parseInt(numMatch[1]);
    if (m >= 1 && m <= 12) {
      const year = new Date().getFullYear();
      return `${year}-${String(m).padStart(2, '0')}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Evidence query handler
// ---------------------------------------------------------------------------

async function handleEvidenceQuery(db, unit, query, history = []) {
  try {
    return await handleEvidenceQueryInner(db, unit, query, history);
  } catch (err) {
    console.error('[advisor/evidence] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'evidence query failed' },
      { status: 500 }
    );
  }
}

async function handleEvidenceQueryInner(db, unit, query, history = []) {
  const intent = detectIntent(query);

  // Extract date range from query (e.g. "for April" → { dateFrom: '2026-04-01', dateTo: '2026-05-01' })
  // Passed to gatherers that support date scoping
  const dateRange = extractDateRange(query);

  let evidence;
  switch (intent.handler) {
    case 'availability':
      evidence = gatherAvailabilityEvidence(db, unit, dateRange);
      break;
    case 'competitorPricing':
      evidence = gatherCompetitorPricingEvidence(db, unit, dateRange);
      break;
    case 'runDetail':
      evidence = gatherRunDetailEvidence(db, unit, extractRunId(query));
      break;
    case 'runsForMonth':
      evidence = gatherRunsForMonthEvidence(db, unit, extractMonth(query));
      break;
    case 'marketTrend':
      evidence = gatherMarketTrendEvidence(db, unit, dateRange);
      break;
    case 'dataCoverage':
      evidence = gatherDataCoverageEvidence(db, unit);
      break;
    case 'comparison':
      evidence = gatherComparisonEvidence(db, unit, dateRange);
      break;
    case 'cheapest':
      evidence = gatherCheapestByStayLength(db, unit, extractStayNights(query), dateRange);
      break;
    case 'bookedAnalysis':
      evidence = gatherBookedVsAvailableEvidence(db, unit, dateRange);
      break;
    default:
      // Broad context: availability + trend
      evidence = {
        unitScope: unit || 'all',
        availability: gatherAvailabilityEvidence(db, unit, dateRange),
        trend: gatherMarketTrendEvidence(db, unit, dateRange),
      };
  }

  if (!evidence) {
    return NextResponse.json({
      success: false,
      error: 'No data found for this query. Try running an analysis first.',
    }, { status: 400 });
  }

  const result = await answerEvidenceQuestion({ query, evidence, intent: intent.handler, history });

  return NextResponse.json({
    success: true,
    data: {
      type: 'evidence',
      intent: intent.handler,
      query,
      answer: result.answer,
      evidence: result.evidence,
    },
  });
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request) {
  const authResult = await requireRole(request, ['admin']);
  if (authResult.error) return authResult.error;

  try {
    const body = await request.json();
    const { unit, message, context, query, history } = body;

    // Evidence query mode — unit is nullable (null = both units)
    if (query) {
      const db = getDb();
      // `return await` is intentional: a bare `return` of an async call
      // escapes the outer try/catch (the function has already resolved
      // to a thenable). Without await, an exception inside
      // handleEvidenceQuery becomes an unhandled rejection → Next.js
      // serves a bare 500 with no body and the chat shows "no response".
      return await handleEvidenceQuery(db, unit || null, query, history || []);
    }

    // Recommendation + chat flows default to unit-a when unspecified
    const recUnit = unit || 'unit-a';

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
    `).all(recUnit, today);

    if (recommendations.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No autopilot data available. Run the analysis first.',
      }, { status: 400 });
    }

    const competitors = db.prepare(
      'SELECT * FROM competitors WHERE comp_unit = ? AND active = 1'
    ).all(recUnit);

    // Competitor timeline evidence (cross-run price movement + availability)
    const { compTimeline } = getPricingLib();
    let evidence = null;
    try {
      evidence = compTimeline.getMarketMovementSummary(db, recUnit);
    } catch { /* timeline data may not exist yet */ }

    // 2. Layer 1+2: Build decisions from pre-computed recommendations
    // The analysis pipeline (autopilot) already computed comp counts, TCPNs,
    // floor/target/stretch, confidence, etc. We apply the decision matrix on
    // top rather than re-running analyzeDateMultiStay from sparse snapshots.
    const { stats, availability, decisionEngine, dates: dateUtils } = getPricingLib();
    const trend = decisionEngine.classifyMarketTrend(db, recUnit);

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
        const availResult = availability.classifyAvailability(db, recUnit, rec.check_date);

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
        const myRateRow = db.prepare('SELECT * FROM my_rates WHERE unit_id = ? AND check_date = ?').get(recUnit, rec.check_date);
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
      unit: recUnit,
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
        recUnit,
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
