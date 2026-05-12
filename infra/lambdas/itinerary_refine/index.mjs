import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const bedrock = new BedrockRuntimeClient({ region: REGION });
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export const handler = async (event) => {
  try {
    const { plan_id, day_num, user_request } = JSON.parse(event.body || '{}');
    if (!plan_id || !day_num || !user_request) return resp(400, { error: 'missing_fields' });

    const cur = await ddb.send(new GetCommand({ TableName: process.env.ITINERARIES_TABLE, Key: { plan_id } }));
    if (!cur.Item) return resp(404, { error: 'plan_not_found' });

    const scan = await ddb.send(new ScanCommand({ TableName: process.env.ACTIVITIES_TABLE }));
    const matched = (scan.Items || []).filter((a) =>
      (a.best_for_persona || []).some((p) => (cur.Item.interests || []).includes(p))
    );

    const newDay = await regenerateDay({ existing: cur.Item, day_num, user_request, activities: matched });
    const updatedDays = (cur.Item.days || []).map((d) => (d.day_num === day_num ? newDay : d));

    await ddb.send(
      new UpdateCommand({
        TableName: process.env.ITINERARIES_TABLE,
        Key: { plan_id },
        UpdateExpression: 'SET days = :d, last_refined_at = :t',
        ExpressionAttributeValues: { ':d': updatedDays, ':t': new Date().toISOString() },
      })
    );

    return resp(200, { day: newDay });
  } catch (err) {
    console.error('refine failed:', err);
    return resp(500, { error: 'refine_failed', detail: err.message });
  }
};

async function regenerateDay({ existing, day_num, user_request, activities }) {
  const compact = activities.map((a) => ({
    id: a.activity_id, name: a.name, neighborhood: a.neighborhood, type: a.type,
    time_of_day: a.ideal_time_of_day, duration_min: a.time_to_allocate_min,
    persona: a.best_for_persona, why: a.why_it_matters,
  }));

  const messages = [{
    role: 'user',
    content: [{ type: 'text', text: `Regenerate ONLY day ${day_num} of an existing itinerary.

USER REQUEST: ${user_request}

EXISTING ITINERARY:
${JSON.stringify(existing.days)}

Output a single Day JSON object (not an array) matching the schema:
{"day_num": ${day_num}, "theme": "string", "items":[{"activity_id":"string","time":"morning|afternoon|evening","duration_min":number,"note":"string"}]}

Use ONLY activities from ACTIVITIES_DB:
${JSON.stringify(compact)}` }],
  }];

  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 1024, messages }),
  }));
  const raw = JSON.parse(new TextDecoder().decode(res.body));
  const text = raw.content?.[0]?.text || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1) throw new Error('Bedrock response had no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

function resp(status, body) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
