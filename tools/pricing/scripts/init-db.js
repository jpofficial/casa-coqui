#!/usr/bin/env node

/**
 * Initialize the pricing database.
 * Creates tables from schema.sql and seeds the holiday calendar.
 *
 * Usage: node tools/pricing/scripts/init-db.js
 */

const { initDb, closeDb, DB_PATH } = require('../lib/db');
const { seedHolidays } = require('../lib/holidays');
const fs = require('fs');

console.log('Initializing pricing database...');
console.log(`  Database: ${DB_PATH}`);

const existed = fs.existsSync(DB_PATH);
const db = initDb();

if (!existed) {
  console.log('  Created new database.');
} else {
  console.log('  Database already exists — ensuring schema is up to date.');
}

const holidayCount = seedHolidays(db);
const actual = db.prepare('SELECT COUNT(*) as count FROM holidays').get();
console.log(`  Holidays: ${actual.count} in calendar (${holidayCount} defined)`);

// Verify tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log(`  Tables: ${tables.map((t) => t.name).join(', ')}`);

closeDb();
console.log('Done.');
