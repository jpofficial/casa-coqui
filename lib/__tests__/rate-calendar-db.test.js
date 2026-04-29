const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const {
  getRecommendationsForMonth,
  getRecommendationForDate,
  getCompBookedSummaryForDate,
  getTopCompsForDate,
  getLatestRunMeta,
  getCompSetSummaryForUnit,
} = require('../../tools/pricing/lib/db.js');

// Build a fresh in-memory DB seeded with minimal schema.
function seedDb() {
  const db = new Database(':memory:');
  const schema = fs.readFileSync(path.join(process.cwd(), 'tools/pricing/schema.sql'), 'utf8');
  db.exec(schema);
  // Apply migrations v3..v15 in order.
  for (const f of fs.readdirSync(path.join(process.cwd(), 'tools/pricing')).filter(n => /^migrate-v\d+\.sql$/.test(n)).sort((a,b)=>+a.match(/\d+/)[0]-+b.match(/\d+/)[0])) {
    const sql = fs.readFileSync(path.join(process.cwd(), 'tools/pricing', f), 'utf8');
    const stmts = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean);
    for (const s of stmts) { try { db.exec(s); } catch {} }
  }
  return db;
}

test('getRecommendationsForMonth returns rows only for the requested month and unit', () => {
  const db = seedDb();
  db.prepare('INSERT INTO recommendations_v2 (unit_id, check_date, rec_nightly_rate, verdict, confidence, demand_signal, tcpn_2n) VALUES (?,?,?,?,?,?,?)').run('unit-a', '2026-04-01', 160, 'hold', 70, 'open', 180);
  db.prepare('INSERT INTO recommendations_v2 (unit_id, check_date, rec_nightly_rate, verdict, confidence, demand_signal, tcpn_2n) VALUES (?,?,?,?,?,?,?)').run('unit-a', '2026-04-15', 175, 'raise', 72, 'tight', 220);
  db.prepare('INSERT INTO recommendations_v2 (unit_id, check_date, rec_nightly_rate, verdict, confidence, demand_signal, tcpn_2n) VALUES (?,?,?,?,?,?,?)').run('unit-a', '2026-05-01', 200, 'hold', 60, 'open', 210);
  db.prepare('INSERT INTO recommendations_v2 (unit_id, check_date, rec_nightly_rate, verdict, confidence, demand_signal, tcpn_2n) VALUES (?,?,?,?,?,?,?)').run('unit-b', '2026-04-10', 250, 'raise', 80, 'tight', 260);

  const rows = getRecommendationsForMonth(db, 'unit-a', '2026-04');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.check_date), ['2026-04-01', '2026-04-15']);
});

test('getRecommendationsForMonth returns empty array for a month with no data', () => {
  const db = seedDb();
  const rows = getRecommendationsForMonth(db, 'unit-a', '2030-12');
  assert.deepEqual(rows, []);
});

test('getRecommendationForDate returns a single row for unit+date', () => {
  const db = seedDb();
  db.prepare('INSERT INTO recommendations_v2 (unit_id, check_date, rec_nightly_rate, verdict, confidence, demand_signal, tcpn_2n, reasoning) VALUES (?,?,?,?,?,?,?,?)').run('unit-a', '2026-04-10', 215, 'raise', 72, 'tight', 220, '{"weekdayMultiplier":1.12,"trend":"strengthening"}');
  const row = getRecommendationForDate(db, 'unit-a', '2026-04-10');
  assert.equal(row.rec_nightly_rate, 215);
  assert.equal(row.verdict, 'raise');
});

test('getRecommendationForDate returns null when no row exists', () => {
  const db = seedDb();
  const row = getRecommendationForDate(db, 'unit-a', '2026-04-10');
  assert.equal(row, null);
});

test('getCompBookedSummaryForDate computes pct booked from calendar_availability', () => {
  const db = seedDb();
  // 3 active comps for unit-a
  db.prepare('INSERT INTO competitors (airbnb_id, name, bedrooms, bathrooms, comp_unit, active) VALUES (?,?,1,1,?,1)').run('1001', 'Ocean View', 'unit-a');
  db.prepare('INSERT INTO competitors (airbnb_id, name, bedrooms, bathrooms, comp_unit, active) VALUES (?,?,1,1,?,1)').run('1002', 'Seaside', 'unit-a');
  db.prepare('INSERT INTO competitors (airbnb_id, name, bedrooms, bathrooms, comp_unit, active) VALUES (?,?,1,1,?,1)').run('1003', 'Palm', 'unit-a');
  const [{ id: c1 }] = db.prepare("SELECT id FROM competitors WHERE airbnb_id='1001'").all();
  const [{ id: c2 }] = db.prepare("SELECT id FROM competitors WHERE airbnb_id='1002'").all();
  const [{ id: c3 }] = db.prepare("SELECT id FROM competitors WHERE airbnb_id='1003'").all();
  // Seed a research run
  db.prepare("INSERT INTO research_runs (id, comp_unit, started_at, status) VALUES (1, 'unit-a', datetime('now'), 'success')").run();
  // 2 booked, 1 available for 2026-04-10
  db.prepare('INSERT INTO calendar_availability (run_id, competitor_id, airbnb_id, date, display_status) VALUES (1, ?, ?, ?, ?)').run(c1, '1001', '2026-04-10', 'not_available');
  db.prepare('INSERT INTO calendar_availability (run_id, competitor_id, airbnb_id, date, display_status) VALUES (1, ?, ?, ?, ?)').run(c2, '1002', '2026-04-10', 'not_available');
  db.prepare('INSERT INTO calendar_availability (run_id, competitor_id, airbnb_id, date, display_status) VALUES (1, ?, ?, ?, ?)').run(c3, '1003', '2026-04-10', 'available');

  const summary = getCompBookedSummaryForDate(db, 'unit-a', '2026-04-10');
  assert.equal(summary.total, 3);
  assert.equal(summary.booked, 2);
  assert.equal(summary.pct, 67);
});

test('getCompBookedSummaryForDate returns zeros when no availability data', () => {
  const db = seedDb();
  const summary = getCompBookedSummaryForDate(db, 'unit-a', '2030-01-01');
  assert.deepEqual(summary, { total: 0, booked: 0, pct: 0 });
});

test('getTopCompsForDate returns comps sorted by price desc with booked flag and bedrooms', () => {
  const db = seedDb();
  db.prepare('INSERT INTO competitors (airbnb_id, name, comp_unit, active, bedrooms, bathrooms) VALUES (?,?,?,1,2,1)').run('2001', 'Ocean View', 'unit-a');
  db.prepare('INSERT INTO competitors (airbnb_id, name, comp_unit, active, bedrooms, bathrooms) VALUES (?,?,?,1,2,1)').run('2002', 'Seaside', 'unit-a');
  const [{ id: c1 }] = db.prepare("SELECT id FROM competitors WHERE airbnb_id='2001'").all();
  const [{ id: c2 }] = db.prepare("SELECT id FROM competitors WHERE airbnb_id='2002'").all();
  db.prepare('INSERT INTO snapshots_v2 (competitor_id, check_date, stay_nights, nightly_rate, available) VALUES (?, ?, 2, 245, 0)').run(c1, '2026-04-10');
  db.prepare('INSERT INTO snapshots_v2 (competitor_id, check_date, stay_nights, nightly_rate, available) VALUES (?, ?, 2, 220, 1)').run(c2, '2026-04-10');
  // Seed research_run + calendar_availability for the booked flag
  db.prepare("INSERT INTO research_runs (id, started_at, status, comp_unit) VALUES (10, datetime('now'), 'success', 'unit-a')").run();
  db.prepare('INSERT INTO calendar_availability (run_id, competitor_id, airbnb_id, date, display_status) VALUES (10, ?, ?, ?, ?)').run(c1, '2001', '2026-04-10', 'not_available');
  db.prepare('INSERT INTO calendar_availability (run_id, competitor_id, airbnb_id, date, display_status) VALUES (10, ?, ?, ?, ?)').run(c2, '2002', '2026-04-10', 'available');

  const comps = getTopCompsForDate(db, 'unit-a', '2026-04-10', { stayNights: 2, limit: 5 });
  assert.equal(comps.length, 2);
  assert.equal(comps[0].name, 'Ocean View');
  assert.equal(comps[0].nightly_rate, 245);
  assert.equal(comps[0].bedrooms, 2);
  assert.equal(comps[0].booked, true);
  assert.equal(comps[1].bedrooms, 2);
  assert.equal(comps[1].booked, false);
});

test('getTopCompsForDate respects limit and empty result', () => {
  const db = seedDb();
  const comps = getTopCompsForDate(db, 'unit-a', '2026-04-10', { stayNights: 2, limit: 5 });
  assert.deepEqual(comps, []);
});

test('getLatestRunMeta returns the newest autopilot_runs row', () => {
  const db = seedDb();
  db.prepare("INSERT INTO autopilot_runs (id, started_at, status, trigger, comps_active) VALUES (1, '2026-04-20T06:00:00Z', 'success', 'cron', 18)").run();
  db.prepare("INSERT INTO autopilot_runs (id, started_at, status, trigger, comps_active) VALUES (2, '2026-04-21T18:00:00Z', 'success', 'cron', 18)").run();
  const meta = getLatestRunMeta(db);
  assert.equal(meta.id, 2);
  assert.equal(meta.started_at, '2026-04-21T18:00:00Z');
  assert.equal(meta.comps_active, 18);
});

test('getLatestRunMeta returns null when no runs exist', () => {
  const db = seedDb();
  assert.equal(getLatestRunMeta(db), null);
});

test('getCompSetSummaryForUnit summarizes active comps for a unit', () => {
  const db = seedDb();
  // 3 unit-a comps (2 BR, 3 BR, 4 BR) + 1 inactive (should be excluded) + 1 unit-b
  db.prepare('INSERT INTO competitors (airbnb_id, name, comp_unit, active, bedrooms, bathrooms) VALUES (?,?,?,1,2,1)').run('3001', 'Casa A', 'unit-a');
  db.prepare('INSERT INTO competitors (airbnb_id, name, comp_unit, active, bedrooms, bathrooms) VALUES (?,?,?,1,3,2)').run('3002', 'Casa B', 'unit-a');
  db.prepare('INSERT INTO competitors (airbnb_id, name, comp_unit, active, bedrooms, bathrooms) VALUES (?,?,?,1,4,2)').run('3003', 'Casa C', 'unit-a');
  db.prepare('INSERT INTO competitors (airbnb_id, name, comp_unit, active, bedrooms, bathrooms) VALUES (?,?,?,0,5,3)').run('3004', 'Casa Inactive', 'unit-a');
  db.prepare('INSERT INTO competitors (airbnb_id, name, comp_unit, active, bedrooms, bathrooms) VALUES (?,?,?,1,2,1)').run('3005', 'Unit B Casa', 'unit-b');

  const summary = getCompSetSummaryForUnit(db, 'unit-a');
  assert.equal(summary.count, 3);
  assert.equal(summary.minBedrooms, 2);
  assert.equal(summary.maxBedrooms, 4);
  assert.equal(summary.avgBedrooms, 3.0);
});

test('getCompSetSummaryForUnit returns zeros when no active comps', () => {
  const db = seedDb();
  const summary = getCompSetSummaryForUnit(db, 'unit-a');
  assert.deepEqual(summary, { count: 0, minBedrooms: null, maxBedrooms: null, avgBedrooms: null });
});
