import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { nanoid } from 'nanoid';

const REGION = process.env.AWS_REGION || 'us-east-1';
const ACTIVITIES_TABLE = process.env.ACTIVITIES_TABLE;
const ITINERARIES_TABLE = process.env.ITINERARIES_TABLE;
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const bedrock = new BedrockRuntimeClient({ region: REGION });

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { interests, num_days, traveler_type, pace } = body;

    if (!Array.isArray(interests) || interests.length === 0)
      return resp(400, { error: 'interests required' });
    if (!num_days || num_days < 1 || num_days > 14)
      return resp(400, { error: 'num_days must be 1-14' });

    const plan_id = nanoid(10);
    const activities = await loadActivities(interests);
    const prompt = buildPrompt({ interests, num_days, traveler_type, pace, activities });

    const { days, usage } = await generateWithBedrock(prompt);
    console.log(JSON.stringify({
      metric_type: 'bedrock_invocation',
      model: MODEL_ID,
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens,
      plan_id,
      num_days,
      interests_count: interests.length,
      ts: new Date().toISOString(),
    }));

    const ttl_epoch = Math.floor(Date.now() / 1000) + 90 * 86400;
    await ddb.send(
      new PutCommand({
        TableName: ITINERARIES_TABLE,
        Item: {
          plan_id,
          interests,
          num_days,
          traveler_type,
          pace,
          days,
          generated_at: new Date().toISOString(),
          ttl_epoch,
        },
      })
    );

    return resp(200, { plan_id, days });
  } catch (err) {
    console.error('generate failed:', err);
    return resp(500, { error: 'generation_failed', detail: err.message });
  }
};

async function loadActivities(interests) {
  // Phase-1 simple scan; Phase 2 of this plan adds GSI query
  const out = await ddb.send(new ScanCommand({ TableName: ACTIVITIES_TABLE }));
  return (out.Items || []).filter((item) =>
    (item.best_for_persona || []).some((p) => interests.includes(p))
  );
}

function buildPrompt({ interests, num_days, traveler_type, pace, activities }) {
  const compact = activities.map((a) => ({
    id: a.activity_id,
    name: a.name,
    neighborhood: a.neighborhood,
    type: a.type,
    time_of_day: a.ideal_time_of_day,
    duration_min: a.time_to_allocate_min,
    persona: a.best_for_persona,
    walk: a.walkability_from_old_san_juan,
    why: a.why_it_matters,
  }));

  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `You are a local San Juan friend helping a first-time visitor build a vacation itinerary.

CONSTRAINTS:
- Recommend ONLY activities from ACTIVITIES_DB below.
- For each day, propose 3-5 items balancing geographic clustering, energy variation, persona match, time-of-day.
- Treat Santurce as an evening CLUSTER (Cocina al Fondo + Identidad + La Alcapurria + La Placita).
- Put Old San Juan on Day 1.
- El Yunque on Day 2 or 3, never Day 1.
- NEVER route into La Perla neighborhood (safety). The viewpoint from Calle Norzagaray IS OK.
- The Calle Fortaleza umbrella canopy is GONE as of 2024-2025 — replaced by string lights.

USER PROFILE:
- interests: ${JSON.stringify(interests)}
- num_days: ${num_days}
- traveler_type: ${traveler_type}
- pace: ${pace}

OUTPUT: Strict JSON array of days. NO prose, NO markdown, NO code fences. Schema:
[{"day_num": 1, "theme": "string", "items":[{"activity_id":"string","time":"morning|afternoon|evening","duration_min":number,"note":"string"}]}]

ACTIVITIES_DB:
${JSON.stringify(compact)}`,
        },
      ],
    },
  ];
}

async function generateWithBedrock(messages) {
  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages,
    }),
  });
  const res = await bedrock.send(cmd);
  const raw = JSON.parse(new TextDecoder().decode(res.body));
  const text = raw.content?.[0]?.text || '';
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('Bedrock response had no JSON array');
  return { days: JSON.parse(text.slice(start, end + 1)), usage: raw.usage };
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  };
}
