import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE = process.env.EVENTS_CACHE_TABLE;
const SECRET_NAME = process.env.EVENTBRITE_SECRET_NAME;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const secrets = new SecretsManagerClient({ region: REGION });

let cachedToken = null;
async function getToken() {
  if (cachedToken) return cachedToken;
  const res = await secrets.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
  cachedToken = res.SecretString;
  return cachedToken;
}

export const handler = async () => {
  try {
    const token = await getToken();
    const items = await fetchEventbriteEvents(token);
    const transformed = items.map(toCacheItem).filter(Boolean);
    await batchWrite(transformed);

    console.log(JSON.stringify({
      metric_type: 'events_fetch',
      total_fetched: items.length,
      written: transformed.length,
      ts: new Date().toISOString(),
    }));

    return { statusCode: 200, body: JSON.stringify({ count: transformed.length }) };
  } catch (err) {
    console.error('events-fetch failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function fetchEventbriteEvents(token) {
  // Eventbrite v3 API — organizer events endpoint
  // The public event search API (/v3/events/search/) was deprecated.
  // /v3/users/me/events/ returns events owned by the authenticated organizer.
  // For future integration with a 3rd-party event aggregator, swap this out.
  const url = new URL('https://www.eventbriteapi.com/v3/users/me/events/');
  url.searchParams.set('status', 'live');
  url.searchParams.set('expand', 'venue,category');
  url.searchParams.set('time_filter', 'current_future');
  url.searchParams.set('page_size', '50');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) {
    // Account has no organizer profile yet — return empty, not an error
    console.warn('eventbrite 404: no organizer events found (account may have no published events)');
    return [];
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`eventbrite ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.events || [];
}

function toCacheItem(ev) {
  const startTime = ev.start?.utc || ev.start?.local;
  const endTime = ev.end?.utc || ev.end?.local;
  if (!startTime || !ev.id) return null;
  const dateIso = startTime.slice(0, 10);
  const endEpoch = endTime
    ? Math.floor(new Date(endTime).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 86400;

  return {
    date_iso: dateIso,
    event_id: ev.id,
    name: ev.name?.text || 'Untitled event',
    venue: ev.venue?.name || null,
    neighborhood: extractNeighborhood(ev.venue),
    category: ev.category?.short_name || null,
    start_time: startTime,
    end_time: endTime,
    price_tier: ev.is_free ? 'FREE' : 'paid',
    url: ev.url || null,
    source: 'eventbrite',
    geo: ev.venue?.latitude ? {
      lat: parseFloat(ev.venue.latitude),
      lng: parseFloat(ev.venue.longitude),
    } : null,
    ttl_epoch: endEpoch + 86400, // expire 1 day after event ends
  };
}

function extractNeighborhood(venue) {
  if (!venue?.address) return null;
  const city = (venue.address.city || '').toLowerCase();
  const addr1 = (venue.address.address_1 || '').toLowerCase();
  const combined = `${addr1} ${city}`;
  if (combined.includes('old san juan') || combined.includes('viejo san juan')) return 'Old San Juan';
  if (combined.includes('condado')) return 'Condado';
  if (combined.includes('santurce')) return 'Santurce';
  if (combined.includes('isla verde')) return 'Isla Verde';
  if (combined.includes('miramar')) return 'Miramar';
  return 'San Juan';
}

async function batchWrite(items) {
  if (!items.length) return;
  // BatchWrite limit: 25 items per request
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: { [TABLE]: batch.map(Item => ({ PutRequest: { Item } })) },
    }));
  }
}
