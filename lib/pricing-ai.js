/**
 * AI Pricing Advisor — Claude-powered rate explanation (Layer 3).
 *
 * The LLM's role is EXPLANATION, not decision-making.
 * The decision engine (Layer 2) determines: action, rate, confidence.
 * The AI explains: why, what evidence, what cautions.
 *
 * Server-side enforcement: all pass-through fields are overwritten
 * with the original rule engine values after LLM response.
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// ---------------------------------------------------------------------------
// System prompt — explanation role, not decision role
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a short-term rental pricing advisor for a vacation property in San Juan, Puerto Rico. Your role is to EXPLAIN a pre-computed pricing recommendation — not to generate rates yourself.

You receive structured data with:
- A recommended action (raise / hold / lower) from a deterministic rule engine
- The suggested rate, price ladder (floor/target/stretch), and confidence level
- Market evidence: comp count, percentile position, trend direction, availability signal
- Warnings about data quality

YOUR RULES:
1. You EXPLAIN the recommendation. You do NOT override it.
2. You must cite specific numbers from the input for every claim.
3. You must NOT generate rates, daily rate tables, or discount percentages.
4. You must NOT say "demand is high" without availability evidence.
5. You must NOT override the rule engine's action, rate, or confidence.
6. Language calibration by confidence tier:
   - High confidence: "shows", "indicates", "the data confirms"
   - Medium confidence: "suggests", "points to", "the data leans toward"
   - Low confidence: "rough guidance", "limited data hints at", "consider"
7. Maximum 150 words for explanation.
8. Be direct and specific — the owner wants clear reasoning, not hedging.
9. All prices in USD. Weekend = Friday + Saturday nights.
10. When mentioning competitor availability, say "unavailable" — never "booked".
11. When competitorEvidence is present, cite specific movement counts (e.g. "3 of 8 competitors raised rates").
12. Use availability transitions as demand evidence (e.g. "4 competitors became unavailable since last analysis").
13. If compReliability.pctRepeat < 50%, note that the competitor set is unstable between analyses.
14. NEVER name individual competitors — refer to them by count only.
15. When competitorEvidence is null, do not speculate about competitor behavior.`;

// ---------------------------------------------------------------------------
// Tool schema — commentary, not rate generation
// ---------------------------------------------------------------------------

const ADVISOR_TOOL_V2 = {
  name: 'pricing_commentary',
  description: 'Explain the pre-computed pricing recommendation with evidence and cautions',
  input_schema: {
    type: 'object',
    properties: {
      // Pass-through fields (LLM echoes these; server overwrites with originals)
      action: {
        type: 'string',
        enum: ['raise', 'hold', 'lower'],
        description: 'Echo the recommended action from the input',
      },
      suggestedRate: {
        type: 'number',
        description: 'Echo the suggested rate from the input',
      },
      floor: { type: 'number', description: 'Echo the floor rate' },
      target: { type: 'number', description: 'Echo the target rate' },
      stretch: { type: 'number', description: 'Echo the stretch rate' },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Echo the confidence tier',
      },
      confidenceScore: { type: 'number', description: 'Echo the confidence score 0-100' },
      weeklyDiscountPct: { type: 'number', description: 'Echo the weekly discount %' },
      monthlyDiscountPct: { type: 'number', description: 'Echo the monthly discount %' },
      marketTrend: {
        type: 'string',
        enum: ['strengthening', 'stable', 'softening'],
        description: 'Echo the market trend',
      },
      // LLM-generated fields
      explanation: {
        type: 'string',
        description: 'Plain-English explanation of the recommendation (2-3 sentences, max 150 words). Must cite specific numbers.',
      },
      opportunities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The opportunity' },
            evidence: { type: 'string', description: 'Specific data point supporting this' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['text', 'evidence', 'priority'],
        },
        description: 'Opportunities the host should consider (0-3 items)',
      },
      cautions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The caution' },
            evidence: { type: 'string', description: 'Specific data point supporting this' },
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['text', 'evidence', 'severity'],
        },
        description: 'Cautions or risks (0-3 items)',
      },
      dataQualityNote: {
        type: 'string',
        description: 'Optional note about data quality concerns. Can flag disagreement but cannot override the recommendation.',
      },
    },
    required: ['action', 'suggestedRate', 'confidence', 'explanation', 'opportunities', 'cautions'],
  },
};

// Keep the legacy tool for backward compat (old dashboard code may reference it)
const ADVISOR_TOOL = ADVISOR_TOOL_V2;

// ---------------------------------------------------------------------------
// Build structured advisor input (~400 tokens, not ~3000)
// ---------------------------------------------------------------------------

/**
 * Build the structured input for the AI advisor.
 * This replaces the old buildUserMessage() text dump.
 *
 * @param {Object} params
 * @param {Object} params.summary - From decision-engine summarizeDecisions()
 * @param {Object[]} params.decisions - Per-date decisions from decision-engine
 * @param {Object[]} params.competitors - Active competitor rows
 * @param {string} params.unit - Unit ID
 * @param {Object|null} params.evidence - From compTimeline.getMarketMovementSummary()
 * @returns {string} Structured JSON as user message
 */
function buildAdvisorInput({ summary, decisions, competitors, unit, evidence }) {
  const today = new Date().toISOString().split('T')[0];

  // Compact competitor summary
  const compSummary = competitors.slice(0, 10).map(c => ({
    name: c.name?.substring(0, 40),
    br: c.bedrooms,
    ba: c.bathrooms,
    rate: c.base_rate,
    fee: c.cleaning_fee,
    rating: c.rating,
    reviews: c.review_count,
    superhost: !!c.superhost,
  }));

  // Count day types in decisions
  const active = decisions.filter(d => d.action !== 'suppress' && !d.isBooked);
  const weekdayCount = active.filter(d => d.dayOfWeek === 'weekday').length;
  const weekendCount = active.filter(d => d.dayOfWeek === 'friday' || d.dayOfWeek === 'saturday').length;
  const holidayDates = active.filter(d => d.holiday).map(d => ({ date: d.date, name: d.holiday }));
  const bookedCount = decisions.filter(d => d.isBooked).length;
  const insufficientCount = decisions.filter(d => d.action === 'suppress').length;

  // Weekly/monthly discount from first decision that has market data
  const withMarket = decisions.find(d => d.decision?.suggestedRate);
  const recNightly = decisions[0];

  const input = {
    property: {
      unit,
      analysisDate: today,
      horizon: `${decisions.length} days`,
    },
    market: {
      compCount: summary.compCount,
      medianTcpn2n: null, // Filled from decisions if available
      spreadCV: null,
      freshnessDays: decisions[0]?.dataAgeDays || null,
    },
    position: {
      yourAvgRate: summary.currentRate,
      percentile: summary.avgPercentile,
    },
    season: {
      name: summary.season,
    },
    trends: {
      marketDirection: summary.marketTrend,
      deltaPct: summary.trendDeltaPct,
      availabilitySignal: summary.availabilitySignal,
    },
    dateContext: {
      weekdayCount,
      weekendCount,
      holidayDates,
      bookedDates: bookedCount,
      insufficientDataDates: insufficientCount,
    },
    recommendation: {
      action: summary.action,
      suggestedRate: summary.suggestedRate,
      currentRate: summary.currentRate,
      priceGapPct: summary.currentRate && summary.suggestedRate
        ? Math.round(((summary.suggestedRate - summary.currentRate) / summary.currentRate) * 100 * 10) / 10
        : null,
      floor: decisions.find(d => d.decision?.floor)?.decision.floor || null,
      target: decisions.find(d => d.decision?.target)?.decision.target || null,
      stretch: decisions.find(d => d.decision?.stretch)?.decision.stretch || null,
      weeklyDiscountPct: recNightly?.recWeeklyPct || 10,
      monthlyDiscountPct: recNightly?.recMonthlyPct || 25,
      confidence: summary.confidence,
      confidenceScore: summary.confidenceScore,
      warnings: summary.warnings.map(w => ({ code: w.code, severity: w.severity, message: w.message })),
    },
    verdictDistribution: summary.verdictDistribution,
    competitors: compSummary,
    competitorEvidence: evidence ? {
      priceMovement: evidence.priceMovement ? {
        raised: evidence.priceMovement.raised,
        lowered: evidence.priceMovement.lowered,
        unchanged: evidence.priceMovement.unchanged,
        dominantDirection: evidence.priceMovement.dominantDirection,
        topMovers: evidence.priceMovement.topMovers?.slice(0, 5).map(m => ({
          name: m.name, direction: m.direction, delta: m.delta, pctChange: m.pctChange,
        })),
      } : null,
      availability: evidence.availabilityEvidence ? {
        signal: evidence.availabilityEvidence.signal,
        becameUnavailable: evidence.availabilityEvidence.becameUnavailable,
        becameAvailable: evidence.availabilityEvidence.becameAvailable,
      } : null,
      reliability: evidence.compReliability ? {
        repeatComps: evidence.compReliability.repeatComps,
        totalComps: evidence.compReliability.totalComps,
        pctRepeat: evidence.compReliability.pctRepeat,
      } : null,
      daysBetweenRuns: evidence.runContext?.daysBetween || null,
    } : null,
  };

  return JSON.stringify(input, null, 0); // Compact JSON
}

// ---------------------------------------------------------------------------
// Generate advice (main entry point)
// ---------------------------------------------------------------------------

/**
 * Generate AI pricing commentary from structured decision engine output.
 *
 * @param {Object} params
 * @param {Object} params.summary - From summarizeDecisions()
 * @param {Object[]} params.decisions - Per-date decisions
 * @param {Object[]} params.competitors - Active competitor rows
 * @param {string} params.unit - Unit ID
 * @param {Object|null} params.evidence - From compTimeline.getMarketMovementSummary()
 * @returns {Promise<Object>} { advice, toolUseId, dataMessage }
 */
export async function generatePricingAdvice({ summary, decisions, competitors, unit, evidence }) {
  const userMessage = buildAdvisorInput({ summary, decisions, competitors, unit, evidence });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [ADVISOR_TOOL_V2],
    tool_choice: { type: 'tool', name: 'pricing_commentary' },
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const toolUse = response.content.find(block => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('AI did not return a structured commentary');
  }

  // SERVER-SIDE ENFORCEMENT: overwrite pass-through fields with rule engine values
  const advice = enforcePassthrough(toolUse.input, summary, decisions);

  return { advice, toolUseId: toolUse.id, dataMessage: userMessage };
}

// ---------------------------------------------------------------------------
// Server-side pass-through enforcement
// ---------------------------------------------------------------------------

/**
 * Overwrite all pass-through fields in the LLM output with original rule engine values.
 * The LLM is told to echo them (forces acknowledgment), but code treats them as constants.
 *
 * @param {Object} llmOutput - Raw tool_use input from Claude
 * @param {Object} summary - From summarizeDecisions()
 * @param {Object[]} decisions - Per-date decisions
 * @returns {Object} Enforced advice object
 */
function enforcePassthrough(llmOutput, summary, decisions) {
  const firstDecision = decisions.find(d => d.decision?.floor) || decisions[0];

  return {
    // Pass-through fields (ALWAYS from rule engine, never LLM)
    action: summary.action,
    suggestedRate: summary.suggestedRate,
    currentRate: summary.currentRate,
    delta: summary.delta,
    floor: firstDecision?.decision?.floor || firstDecision?.floor || null,
    target: firstDecision?.decision?.target || firstDecision?.target || null,
    stretch: firstDecision?.decision?.stretch || firstDecision?.stretch || null,
    confidence: summary.confidence,
    confidenceScore: summary.confidenceScore,
    weeklyDiscountPct: decisions[0]?.recWeeklyPct || 10,
    monthlyDiscountPct: decisions[0]?.recMonthlyPct || 25,
    marketTrend: summary.marketTrend,
    availabilitySignal: summary.availabilitySignal,
    verdictDistribution: summary.verdictDistribution,
    compCount: summary.compCount,
    avgPercentile: summary.avgPercentile,
    season: summary.season,

    // LLM-generated fields (kept as-is, coerced to arrays)
    explanation: llmOutput.explanation || 'No explanation provided.',
    opportunities: Array.isArray(llmOutput.opportunities) ? llmOutput.opportunities : [],
    cautions: Array.isArray(llmOutput.cautions) ? llmOutput.cautions : [],
    dataQualityNote: llmOutput.dataQualityNote || null,

    // Warnings from rule engine (not LLM)
    warnings: summary.warnings,
  };
}

// ---------------------------------------------------------------------------
// Follow-up chat (locked down: text only, no tool use)
// ---------------------------------------------------------------------------

/**
 * Continue a conversation with the advisor after the initial report.
 * LOCKED DOWN: no tools offered. Text-only responses. Max 512 tokens.
 *
 * @param {Object} params
 * @param {string} params.dataMessage - The original structured input
 * @param {string} params.toolUseId - The tool_use ID from initial response
 * @param {Object} params.initialAdvice - The initial structured recommendation
 * @param {Array} params.followUps - Array of { role, content }
 * @param {string} params.userMessage - The new user message
 * @returns {Promise<{ text: string }>}
 */
export async function chatWithAdvisor({ dataMessage, toolUseId, initialAdvice, followUps, userMessage }) {
  const messages = [
    { role: 'user', content: dataMessage },
    {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolUseId,
        name: 'pricing_commentary',
        input: initialAdvice,
      }],
    },
  ];

  if (followUps.length === 0) {
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: 'Report displayed to the property owner.' },
        { type: 'text', text: userMessage },
      ],
    });
  } else {
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: 'Report displayed to the property owner.' },
        { type: 'text', text: followUps[0].content },
      ],
    });
    for (let i = 1; i < followUps.length; i++) {
      messages.push({ role: followUps[i].role, content: followUps[i].content });
    }
    messages.push({ role: 'user', content: userMessage });
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT + `\n\nThe owner is chatting about the recommendation. Answer concisely (max 100 words). You CANNOT change the recommendation, regenerate rates, or use tools. If they ask "what if I price at $X?" compute the approximate percentile from the comp data in the original input. Stay factual.`,
    // NO tools offered — text-only responses
    messages,
  });

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }

  // No updatedAdvice — chat cannot override the recommendation
  return { text };
}

// Legacy export for backward compat
export { buildAdvisorInput };
