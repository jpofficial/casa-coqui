#!/usr/bin/env node

/**
 * Add or update a competitor listing.
 *
 * Usage:
 *   node tools/pricing/scripts/add-comp.js \
 *     --unit unit-a \
 *     --name "Cozy Studio in Condado" \
 *     --bedrooms 2 --bathrooms 1 \
 *     --cleaning-fee 45 \
 *     --neighborhood Condado \
 *     [--url "https://airbnb.com/rooms/123"] \
 *     [--host "Jane"] \
 *     [--max-guests 4] \
 *     [--sqft 400] \
 *     [--amenities "ac,wifi,kitchen,parking"] \
 *     [--rating 4.82] \
 *     [--reviews 47] \
 *     [--superhost] \
 *     [--min-nights 2] \
 *     [--notes "Corner unit, street noise"]
 *
 *   Or from JSON:
 *   node tools/pricing/scripts/add-comp.js --json '{ ... }'
 *   node tools/pricing/scripts/add-comp.js --file comp-data.json
 */

const { initDb, closeDb, logAction } = require('../lib/db');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--superhost') {
      args.superhost = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      args[key] = argv[++i];
    }
  }
  return args;
}

function extractAirbnbId(url) {
  if (!url) return null;
  const match = url.match(/rooms\/(\d+)/);
  return match ? match[1] : null;
}

function run() {
  const args = parseArgs(process.argv);
  const db = initDb();

  let data;

  if (args.json) {
    data = JSON.parse(args.json);
  } else if (args.file) {
    data = JSON.parse(require('fs').readFileSync(args.file, 'utf8'));
  } else {
    data = {
      url: args.url || null,
      name: args.name,
      host_name: args.host || null,
      neighborhood: args.neighborhood || null,
      bedrooms: parseInt(args.bedrooms),
      bathrooms: parseFloat(args.bathrooms || '1'),
      max_guests: args['max-guests'] ? parseInt(args['max-guests']) : null,
      sqft: args.sqft ? parseInt(args.sqft) : null,
      amenities: args.amenities ? args.amenities.split(',').map((s) => s.trim()) : null,
      rating: args.rating ? parseFloat(args.rating) : null,
      review_count: args.reviews ? parseInt(args.reviews) : null,
      superhost: args.superhost ? 1 : 0,
      min_nights: args['min-nights'] ? parseInt(args['min-nights']) : 1,
      cleaning_fee: args['cleaning-fee'] ? parseFloat(args['cleaning-fee']) : 0,
      comp_unit: args.unit,
      notes: args.notes || null,
    };
  }

  // Validation
  if (!data.name) { console.error('Error: --name is required'); process.exit(1); }
  if (!data.comp_unit) { console.error('Error: --unit is required (unit-a or unit-b)'); process.exit(1); }
  if (!data.bedrooms) { console.error('Error: --bedrooms is required'); process.exit(1); }
  if (!['unit-a', 'unit-b'].includes(data.comp_unit)) {
    console.error('Error: --unit must be "unit-a" or "unit-b"'); process.exit(1);
  }

  const airbnbId = extractAirbnbId(data.url);
  const amenitiesJson = Array.isArray(data.amenities) ? JSON.stringify(data.amenities) : data.amenities;

  // Upsert by airbnb_id if available, otherwise insert
  if (airbnbId) {
    const existing = db.prepare('SELECT id FROM competitors WHERE airbnb_id = ?').get(airbnbId);
    if (existing) {
      db.prepare(`
        UPDATE competitors SET
          name = ?, url = ?, host_name = ?, neighborhood = ?, bedrooms = ?, bathrooms = ?,
          max_guests = ?, sqft = ?, amenities = ?, rating = ?, review_count = ?,
          superhost = ?, min_nights = ?, cleaning_fee = ?, comp_unit = ?, notes = ?,
          updated_at = datetime('now')
        WHERE airbnb_id = ?
      `).run(
        data.name, data.url, data.host_name, data.neighborhood, data.bedrooms, data.bathrooms,
        data.max_guests, data.sqft, amenitiesJson, data.rating, data.review_count,
        data.superhost ? 1 : 0, data.min_nights, data.cleaning_fee, data.comp_unit, data.notes,
        airbnbId
      );
      console.log(`Updated competitor #${existing.id}: "${data.name}"`);
      logAction('comp_update', { id: existing.id, name: data.name });
      closeDb();
      return;
    }
  }

  const result = db.prepare(`
    INSERT INTO competitors (airbnb_id, name, url, host_name, neighborhood, bedrooms, bathrooms,
      max_guests, sqft, amenities, rating, review_count, superhost, min_nights, cleaning_fee,
      comp_unit, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    airbnbId, data.name, data.url, data.host_name, data.neighborhood, data.bedrooms, data.bathrooms,
    data.max_guests, data.sqft, amenitiesJson, data.rating, data.review_count,
    data.superhost ? 1 : 0, data.min_nights, data.cleaning_fee, data.comp_unit, data.notes
  );

  console.log(`Added competitor #${result.lastInsertRowid}: "${data.name}" (comp for ${data.comp_unit})`);
  logAction('comp_add', { id: result.lastInsertRowid, name: data.name, unit: data.comp_unit });
  closeDb();
}

run();
