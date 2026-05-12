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
    const { interests, num_days, traveler_type, pace, special_requests } = body;

    if (!Array.isArray(interests) || interests.length === 0)
      return resp(400, { error: 'interests required' });
    if (!num_days || num_days < 1 || num_days > 14)
      return resp(400, { error: 'num_days must be 1-14' });

    const plan_id = nanoid(10);
    const activities = await loadActivities(interests);
    const prompt = buildPrompt({ interests, num_days, traveler_type, pace, special_requests, activities });

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

function buildPrompt({ interests, num_days, traveler_type, pace, special_requests, activities }) {
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
- pace: ${pace}${special_requests ? `

SPECIFIC USER REQUESTS (HIGH PRIORITY — must address these in the itinerary):
"${special_requests}"

If a request mentions a specific activity not in ACTIVITIES_DB (e.g. "salsa lessons", "rum distillery", "bioluminescent bay"), find the closest matching activity in ACTIVITIES_DB and use it. If no match exists, mention the request in a note on a related day's item (e.g., "Locals recommend La Junta on Wednesday nights at La Respuesta for salsa — 5-min walk from La Factoría").` : ''}

OUTPUT: Strict JSON array of days. NO prose, NO markdown, NO code fences. Schema:
[{"day_num": 1, "theme": "string", "narrative": "string", "items":[{"activity_id":"string","time":"morning|afternoon|evening","duration_min":number,"note":"string"}]}]

NARRATIVE FIELD (REQUIRED on every day):
- 2-4 sentences, ~60-100 words. Story-style prose that ties the day's activities together.
- Second-person voice: "Start your morning at...", "Then make your way to...", "Wind down with...".
- Emoji-rich: include 1 emoji per major beat (food 🍴 / coffee ☕ / walk 🚶 / beach 🌊 / sunset 🌅 / fort 🏰 / rainforest 🌴 / drink 🍹 / music 🎶 / market 🛍️). Pick the emoji that fits the activity.
- Include ESTIMATED travel time between activities in approximate language: "5-min walk", "10-min Uber", "20-min drive", "a short stroll around the corner". Infer from general PR geography — DO NOT invent precise minutes or addresses.
- Mostly English with occasional light Spanglish flavor ("grab a cortadito", "head to la playa") is fine, but readable to anglo tourists.
- DO NOT hallucinate addresses, phone numbers, or exact opening hours. Use approximate language like "around lunchtime", "in the afternoon", "after sunset".
- Reference the same activities listed in items[] — the narrative is a friendly retelling of the day, not new recommendations.

<example>
[
  {
    "day_num": 1,
    "theme": "Old San Juan Highlights",
    "narrative": "Start your morning at Café Cuatro Sombras with a Puerto Rican specialty cortadito ☕. Then take a 5-min walk through the blue cobblestones to El Morro for sweeping Atlantic views from the fort 🏰 (allow about 1.5 hours). For lunch, head a few blocks back to Pirilo Pizza 🍕 around the corner. Wind down the evening at La Factoría for craft cocktails 🍹 just a short stroll away.",
    "items": [
      {"activity_id": "cafe-cuatro-sombras", "time": "morning", "duration_min": 45, "note": "Try the cortadito"},
      {"activity_id": "el-morro", "time": "morning", "duration_min": 90, "note": ""},
      {"activity_id": "pirilo-pizza", "time": "afternoon", "duration_min": 60, "note": ""},
      {"activity_id": "la-factoria", "time": "evening", "duration_min": 120, "note": "Multiple themed rooms"}
    ]
  },
  {
    "day_num": 2,
    "theme": "El Yunque Rainforest",
    "narrative": "Hit the road early for a 45-min drive east to El Yunque National Forest 🌴, where you'll hike to La Mina Falls and cool off in the pools 🌊 (plan for the full morning). After the hike, grab lunch at a roadside lechonera in Guavate 🍴 about 30-min away — pork shoulder, rice, and beans done right. Head back to Old San Juan in the late afternoon and catch the sunset 🌅 from Paseo de la Princesa with a piragua in hand.",
    "items": [
      {"activity_id": "el-yunque", "time": "morning", "duration_min": 240, "note": "Bring water and bug spray"},
      {"activity_id": "guavate-lechon", "time": "afternoon", "duration_min": 90, "note": ""},
      {"activity_id": "paseo-princesa", "time": "evening", "duration_min": 60, "note": "Sunset views"}
    ]
  }
]
</example>

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
