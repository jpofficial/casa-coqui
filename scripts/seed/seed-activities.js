#!/usr/bin/env node
/**
 * One-shot seed of the activities DynamoDB table from seed-final JSONs.
 * Idempotent: uses PutItem (overwrites existing rows with same activity_id).
 */
const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = 'mi-itinerario-activities';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const SEED_DIR = path.join(__dirname, '..', '..', 'data', 'itinerary-research', 'seed-final');

async function main() {
  const files = fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.json'));
  let total = 0;

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(SEED_DIR, file), 'utf-8'));
    const items = data.items.map((item, idx) => ({
      ...item,
      activity_id: item.activity_id || `${file.replace('.json', '').toUpperCase()}-${String(idx + 1).padStart(3, '0')}`,
    }));

    // Batch in groups of 25 (DDB limit)
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await client.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: batch.map(Item => ({ PutRequest: { Item } })),
          },
        })
      );
      total += batch.length;
    }
    console.log(`✓ ${file}: ${items.length} items`);
  }
  console.log(`\nTotal seeded: ${total}`);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
