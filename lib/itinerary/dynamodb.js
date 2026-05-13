import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  BatchGetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';

/**
 * Use Mi Itinerario-prefixed credentials if set (so they don't collide with
 * other AWS workflows in the same Vercel project). Falls back to the default
 * AWS SDK credential chain (env vars, ~/.aws/credentials, IAM role) otherwise.
 */
const credentials = process.env.MI_ITINERARIO_AWS_ACCESS_KEY_ID
  ? {
      accessKeyId: process.env.MI_ITINERARIO_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.MI_ITINERARIO_AWS_SECRET_ACCESS_KEY,
    }
  : undefined;

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION, ...(credentials && { credentials }) })
);

export async function getItinerary(plan_id) {
  const res = await ddb.send(
    new GetCommand({
      TableName: process.env.ITINERARIES_TABLE || 'mi-itinerario-itineraries',
      Key: { plan_id },
    })
  );
  return res.Item || null;
}

/**
 * Delete an itinerary by plan_id. Returns { deleted: true } if the item
 * existed and was removed, { deleted: false } if it didn't exist.
 *
 * Requires the runtime IAM identity to have `dynamodb:DeleteItem` on the
 * itineraries table. The Vercel-side IAM user (MI_ITINERARIO_AWS_*) must
 * include this action — if it currently is read-only, this call will
 * throw an AccessDeniedException at runtime.
 */
export async function deleteItinerary(plan_id) {
  const res = await ddb.send(
    new DeleteCommand({
      TableName: process.env.ITINERARIES_TABLE || 'mi-itinerario-itineraries',
      Key: { plan_id },
      ReturnValues: 'ALL_OLD',
    })
  );
  return { deleted: !!res.Attributes };
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
