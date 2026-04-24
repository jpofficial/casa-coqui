const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const {
  getRecommendationsForMonth,
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
