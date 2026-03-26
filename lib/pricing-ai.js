/**
 * AI Pricing Advisor — Claude-powered rate recommendations.
 *
 * Server-side only. Calls Claude Haiku with autopilot data and returns
 * structured pricing advice via tool_use.
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM_PROMPT = `You are a short-term rental pricing advisor for a vacation property in San Juan, Puerto Rico. You analyze market data from competitor Airbnb listings and produce specific, actionable pricing recommendations.

Your goal: recommend a specific nightly rate for EVERY date in the 30-day window, plus weekly/monthly discounts and alerts. Be direct and specific — the owner wants numbers, not vague advice.

Rules:
- All prices in USD
- Weekend = Friday + Saturday nights
- Weekly discount applies to 7+ night stays
- Monthly discount applies to 28+ night stays
- Consider the property's current percentile position vs competitors
- Flag any dates with holiday adjustments or demand surges
- Vary daily rates based on day of week, season, holidays, and demand signals
- If data is insufficient, say so honestly`;

const ADVISOR_TOOL = {
  name: 'pricing_recommendation',
  description: 'Return a structured pricing recommendation with specific rate actions',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A 2-3 sentence executive summary of the recommendation',
      },
      weekdayRate: {
        type: 'number',
        description: 'Recommended weekday nightly rate in USD',
      },
      weekendRate: {
        type: 'number',
        description: 'Recommended weekend (Fri-Sat) nightly rate in USD',
      },
      weeklyDiscount: {
        type: 'number',
        description: 'Recommended weekly discount percentage (0-50)',
      },
      monthlyDiscount: {
        type: 'number',
        description: 'Recommended monthly discount percentage (0-60)',
      },
      dailyRates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            rate: { type: 'number', description: 'Recommended nightly rate in USD for this date' },
            note: { type: 'string', description: 'Brief reason for this rate (e.g. "Weekend premium", "Holiday surge", "Low demand weekday")' },
          },
          required: ['date', 'rate', 'note'],
        },
        description: 'Per-day recommended rate for every date in the 30-day window. One entry per date.',
      },
      actions: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of 2-5 specific actions the owner should take',
      },
      alerts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Time-sensitive alerts about upcoming events, season changes, or demand shifts. Empty array if none.',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Confidence level based on data quality and comp count',
      },
    },
    required: ['summary', 'weekdayRate', 'weekendRate', 'weeklyDiscount', 'monthlyDiscount', 'dailyRates', 'actions', 'alerts', 'confidence'],
  },
};

function buildTrendSection(trendData) {
  if (!trendData || !trendData.insights?.length) {
    return '\n## Market Trends\nNo historical trend data available yet. Recommendations are based on current snapshot only.\n';
  }

  const lines = ['\n## Market Trends (Historical)'];

  // Run count
  if (trendData.dataQuality) {
    lines.push(`- Data points: ${trendData.dataQuality.totalDataPoints} across ${trendData.dataQuality.totalRuns} analysis runs`);
    if (trendData.dataQuality.newestRun) {
      lines.push(`- Latest run: ${trendData.dataQuality.newestRun}`);
    }
  }

  // Insights
  for (const insight of trendData.insights) {
    const severity = insight.severity === 'opportunity' ? '[OPPORTUNITY]' : insight.severity === 'warning' ? '[WARNING]' : '[INFO]';
    lines.push(`- ${severity} ${insight.message}`);
    if (insight.delta != null) {
      lines.push(`  Week-over-week TCPN change: ${insight.delta > 0 ? '+' : ''}${insight.delta.toFixed(1)}%`);
    }
    if (insight.currentPercentile != null) {
      lines.push(`  Your position: P${insight.currentPercentile} (was P${insight.previousPercentile})`);
    }
  }

  // Comp movement
  if (trendData.compMovement?.length > 0) {
    lines.push('\nCompetitor rate changes since last run:');
    for (const m of trendData.compMovement.slice(0, 5)) {
      lines.push(`- ${m.name}: ${m.direction} $${Math.abs(m.delta)} (${m.pctChange}%)`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function buildUserMessage({ recommendations, competitors, seasons, unit, trendData }) {
  const today = new Date().toISOString().split('T')[0];

  // Summarize recommendations
  const recRows = recommendations.map(r => {
    return `${r.check_date} | ${r.day_type} | ${r.season} | rec=$${r.rec_nightly_rate || '?'} | your=$${r.your_rate || '?'} | P${r.percentile || '?'} | ${r.verdict} | comps=${r.comp_count} | ${r.holiday_adjusted ? 'HOLIDAY' : ''}`;
  });

  // Summarize competitors with TCPN breakdown
  const compSummary = competitors.map(c => {
    const tcpn2n = c.base_rate && c.cleaning_fee != null
      ? Math.round((c.base_rate * 2 + (c.cleaning_fee || 0)) / 2 * 100) / 100
      : null;
    const tcpnStr = tcpn2n ? `, 2n-TCPN=$${tcpn2n}` : '';
    return `${c.name}: ${c.bedrooms}BR/${c.bathrooms}BA, base=$${c.base_rate || '?'}/night, cleaning=$${c.cleaning_fee || 0}${tcpnStr}, rating=${c.rating || '?'} (${c.review_count || 0} reviews)${c.superhost ? ' ★Superhost' : ''}`;
  });

  // TCPN distribution for context
  const tcpnValues = competitors
    .map(c => c.base_rate && c.cleaning_fee != null ? Math.round((c.base_rate * 2 + (c.cleaning_fee || 0)) / 2 * 100) / 100 : null)
    .filter(v => v != null)
    .sort((a, b) => a - b);
  const tcpnDistribution = tcpnValues.length > 0
    ? `TCPN distribution (2-night): min=$${tcpnValues[0]}, median=$${tcpnValues[Math.floor(tcpnValues.length / 2)]}, max=$${tcpnValues[tcpnValues.length - 1]} (${tcpnValues.length} comps)`
    : 'No TCPN data available.';

  // Summarize seasons
  const seasonInfo = seasons.map(s => {
    return `${s.name}: months ${s.start_month}-${s.end_month}, target percentile P${s.target_pctl}`;
  });

  // Compute averages
  const withRates = recommendations.filter(r => r.rec_nightly_rate);
  const weekdays = withRates.filter(r => r.day_type === 'weekday');
  const weekends = withRates.filter(r => r.day_type === 'friday' || r.day_type === 'saturday');
  const avgRec = withRates.length > 0 ? Math.round(withRates.reduce((s, r) => s + r.rec_nightly_rate, 0) / withRates.length) : null;
  const avgYour = withRates.filter(r => r.your_rate).length > 0
    ? Math.round(withRates.filter(r => r.your_rate).reduce((s, r) => s + r.your_rate, 0) / withRates.filter(r => r.your_rate).length)
    : null;

  // Data quality assessment
  const compCount = competitors.length;
  const datesWithData = recommendations.filter(r => r.comp_count > 0).length;
  const avgCompsPerDate = datesWithData > 0
    ? Math.round(recommendations.filter(r => r.comp_count > 0).reduce((s, r) => s + r.comp_count, 0) / datesWithData)
    : 0;
  const limitations = [];
  if (compCount < 5) limitations.push(`Small comp set (${compCount} listings) — percentile estimates have wide error bars`);
  if (compCount < 3) limitations.push('Below minimum threshold for statistical reliability');
  if (avgCompsPerDate < compCount * 0.5) limitations.push('Many dates have incomplete comp data');

  return `## Property: ${unit}
Date: ${today}

## Data Quality
- Comp count: ${compCount} active listings
- Dates with data: ${datesWithData}/${recommendations.length}
- Average comps per date: ${avgCompsPerDate}
${limitations.length > 0 ? '- Limitations:\n' + limitations.map(l => `  - ${l}`).join('\n') : '- No significant data quality issues.'}

## 30-Day Recommendations
${recRows.length > 0 ? recRows.join('\n') : 'No recommendation data available.'}

## Quick Stats
- Days analyzed: ${recommendations.length}
- Average recommended rate: ${avgRec ? `$${avgRec}` : 'N/A'}
- Your current average rate: ${avgYour ? `$${avgYour}` : 'N/A'}
- Average weekday rec: ${weekdays.length > 0 ? `$${Math.round(weekdays.reduce((s, r) => s + r.rec_nightly_rate, 0) / weekdays.length)}` : 'N/A'}
- Average weekend rec: ${weekends.length > 0 ? `$${Math.round(weekends.reduce((s, r) => s + r.rec_nightly_rate, 0) / weekends.length)}` : 'N/A'}

## Competitor Landscape (${competitors.length} active comps)
${compSummary.length > 0 ? compSummary.join('\n') : 'No competitor data.'}
${tcpnDistribution}

## Seasons
${seasonInfo.length > 0 ? seasonInfo.join('\n') : 'No season data.'}

${buildTrendSection(trendData)}
Based on this data, provide your pricing recommendation. Include a dailyRates entry for EVERY date listed above — do not skip any. When data is thin (few comps), say so honestly and qualify your confidence. If market trend data is available, factor it into your recommendations — a strengthening market supports more aggressive pricing, a softening market suggests caution.`;
}

/**
 * Generate AI pricing advice from autopilot data.
 *
 * @param {Object} params
 * @param {Array} params.recommendations - Raw recommendations_v2 rows from SQLite
 * @param {Array} params.competitors - Active competitor rows
 * @param {Array} params.seasons - Season rows
 * @param {string} params.unit - Unit ID (e.g. "unit-a")
 * @returns {Promise<Object>} Structured recommendation
 */
export async function generatePricingAdvice({ recommendations, competitors, seasons, unit }) {
  const userMessage = buildUserMessage({ recommendations, competitors, seasons, unit });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [ADVISOR_TOOL],
    tool_choice: { type: 'tool', name: 'pricing_recommendation' },
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  // Extract the tool_use result
  const toolUse = response.content.find(block => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('AI did not return a structured recommendation');
  }

  return { advice: toolUse.input, toolUseId: toolUse.id, dataMessage: userMessage };
}

/**
 * Continue a conversation with the advisor after the initial report.
 *
 * @param {Object} params
 * @param {string} params.dataMessage - The original market data user message
 * @param {string} params.toolUseId - The tool_use ID from the initial response
 * @param {Object} params.initialAdvice - The initial structured recommendation
 * @param {Array} params.followUps - Array of { role: 'user'|'assistant', content: string }
 * @param {string} params.userMessage - The new user message
 * @returns {Promise<{ text: string, updatedAdvice: Object|null }>}
 */
export async function chatWithAdvisor({ dataMessage, toolUseId, initialAdvice, followUps, userMessage }) {
  // Build the full conversation history
  const messages = [
    // 1. Original market data
    { role: 'user', content: dataMessage },
    // 2. AI's initial tool_use response
    {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolUseId,
        name: 'pricing_recommendation',
        input: initialAdvice,
      }],
    },
    // 3. Tool result + first follow-up or just tool result
    // We need a user message with tool_result to complete the tool_use cycle
  ];

  // If there are existing follow-ups, weave them in
  if (followUps.length === 0) {
    // First follow-up: combine tool_result with the user's message
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: 'Report displayed to the property owner.' },
        { type: 'text', text: userMessage },
      ],
    });
  } else {
    // Tool result was already sent in the first follow-up
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: 'Report displayed to the property owner.' },
        { type: 'text', text: followUps[0].content },
      ],
    });
    // Add remaining follow-ups
    for (let i = 1; i < followUps.length; i++) {
      messages.push({ role: followUps[i].role, content: followUps[i].content });
    }
    // Add the new user message
    messages.push({ role: 'user', content: userMessage });
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT + '\n\nThe owner is now chatting with you about the report. Answer concisely. If they ask you to adjust rates, use the pricing_recommendation tool to provide an updated full report. Otherwise, reply with text.',
    tools: [ADVISOR_TOOL],
    tool_choice: { type: 'auto' },
    messages,
  });

  // Parse response — could be text, tool_use, or both
  let text = '';
  let updatedAdvice = null;
  let newToolUseId = null;

  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      updatedAdvice = block.input;
      newToolUseId = block.id;
    }
  }

  return { text, updatedAdvice, newToolUseId };
}
