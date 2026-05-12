import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

export async function getItinerary(plan_id) {
  const res = await ddb.send(
    new GetCommand({
      TableName: process.env.ITINERARIES_TABLE || 'mi-itinerario-itineraries',
      Key: { plan_id },
    })
  );
  return res.Item || null;
}

export async function getActivitiesByIds(activity_ids) {
  if (!activity_ids?.length) return [];
  const out = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [process.env.ACTIVITIES_TABLE || 'mi-itinerario-activities']: {
          Keys: activity_ids.map((id) => ({ activity_id: id })),
        },
      },
    })
  );
  return out.Responses?.[process.env.ACTIVITIES_TABLE || 'mi-itinerario-activities'] || [];
}
