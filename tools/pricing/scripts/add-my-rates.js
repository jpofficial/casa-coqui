#!/usr/bin/env node

/**
 * Record your own rates for a unit.
 *
 * Usage:
 *   # Single rate
 *   node tools/pricing/scripts/add-my-rates.js \
 *     --unit unit-a --date 2026-04-04 --rate 65 --cleaning-fee 40
 *
 *   # Batch from JSON
 *   node tools/pricing/scripts/add-my-rates.js --json '{
 *     "unit_id": "unit-a",
 *     "cleaning_fee": 40,
 *     "min_nights": 2,
 *     "rates": [
 *       { "date": "2026-04-04", "rate": 65 },
 *       { "date": "2026-04-05", "rate": 70, "booked": true }
 *     ]
 *   }'
 *
 *   # Mark as booked
 *   node tools/pricing/scripts/add-my-rates.js --unit unit-a --date 2026-04-04 --rate 65 --booked
 */

const { initDb, closeDb, logAction, recordRateHistory } = require('../lib/db');
const { classifyDayType } = require('../lib/dates');
const { computeTcpn } = require('../lib/normalize');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--booked') {
      args.booked = true;
    } else if (arg.startsWith('--')) {
      args[arg.slice(2)] = argv[++i];
    }
  }
  return args;
}

function insertRate(db, unitId, cleaningFee, minNights, entry) {
  const date = entry.date;
  const rate = parseFloat(entry.rate);
  const dayType = classifyDayType(date);
  const tcpn = computeTcpn(rate, cleaningFee, minNights);
  const booked = entry.booked ? 1 : 0;

  db.prepare(`
    INSERT INTO my_rates (unit_id, check_date, day_type, nightly_rate, cleaning_fee, tcpn, min_nights, is_booked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(unit_id, check_date) DO UPDATE SET
      day_type = excluded.day_type,
      nightly_rate = excluded.nightly_rate,
      cleaning_fee = excluded.cleaning_fee,
      tcpn = excluded.tcpn,
      min_nights = excluded.min_nights,
      is_booked = excluded.is_booked,
      captured_at = datetime('now')
  `).run(unitId, date, dayType, rate, cleaningFee, tcpn, minNights, booked);

  // Append to rate history for trend tracking
  try { recordRateHistory(db, unitId, date, rate, cleaningFee, tcpn, booked); } catch { /* history table may not exist yet */ }

  return { date, dayType, rate, tcpn, booked };
}

function run() {
  const args = parseArgs(process.argv);
  const db = initDb();

  let unitId, cleaningFee, minNights, rates;

  if (args.json) {
    const data = JSON.parse(args.json);
    unitId = data.unit_id;
    cleaningFee = data.cleaning_fee || 0;
    minNights = data.min_nights || 2;
    rates = data.rates;
  } else {
    unitId = args.unit;
    if (!unitId) { console.error('Error: --unit is required (unit-a or unit-b)'); process.exit(1); }
    if (!args.date) { console.error('Error: --date is required (YYYY-MM-DD)'); process.exit(1); }
    if (!args.rate) { console.error('Error: --rate is required'); process.exit(1); }

    cleaningFee = args['cleaning-fee'] ? parseFloat(args['cleaning-fee']) : 0;
    minNights = args['min-nights'] ? parseInt(args['min-nights']) : 2;
    rates = [{ date: args.date, rate: parseFloat(args.rate), booked: !!args.booked }];
  }

  if (!['unit-a', 'unit-b'].includes(unitId)) {
    console.error('Error: --unit must be "unit-a" or "unit-b"'); process.exit(1);
  }

  console.log(`Recording ${rates.length} rate(s) for ${unitId} (cleaning fee: $${cleaningFee}, min nights: ${minNights}):`);

  const results = db.transaction(() => {
    return rates.map((r) => insertRate(db, unitId, cleaningFee, minNights, r));
  })();

  for (const r of results) {
    const status = r.booked ? ' [BOOKED]' : '';
    console.log(`  ${r.date} (${r.dayType}): $${r.rate}/night → TCPN $${r.tcpn}${status}`);
  }

  logAction('rate_update', { unit: unitId, count: results.length });
  closeDb();
  console.log('Done.');
}

run();
