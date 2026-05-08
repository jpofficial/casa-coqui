/**
 * Puerto Rico + US holiday calendar for 2026
 * Used for demand multiplier adjustments
 *
 * YEAR ROLLOVER: This file must be updated each year with the new year's
 * holiday dates. Many holidays (MLK Day, Presidents' Day, Easter, Memorial Day,
 * Labor Day, Thanksgiving) fall on different dates each year. Run seedHolidays()
 * after adding the new year's data to populate the database.
 */

const HOLIDAYS_2026 = [
  { date: '2026-01-01', name: "New Year's Day", type: 'us', peak_multiplier: 1.3 },
  { date: '2026-01-06', name: 'Three Kings Day (PR)', type: 'pr', peak_multiplier: 1.4 },
  { date: '2026-01-19', name: 'MLK Day', type: 'us', peak_multiplier: 1.2 },
  { date: '2026-02-16', name: "Presidents' Day", type: 'us', peak_multiplier: 1.2 },
  { date: '2026-03-22', name: 'Emancipation Day (PR)', type: 'pr', peak_multiplier: 1.2 },
  { date: '2026-04-03', name: 'Good Friday', type: 'us', peak_multiplier: 1.3 },
  { date: '2026-04-05', name: 'Easter', type: 'us', peak_multiplier: 1.3 },
  { date: '2026-05-25', name: 'Memorial Day', type: 'us', peak_multiplier: 1.3 },
  { date: '2026-06-19', name: 'Juneteenth', type: 'us', peak_multiplier: 1.1 },
  { date: '2026-07-04', name: 'Independence Day', type: 'us', peak_multiplier: 1.4 },
  { date: '2026-07-25', name: 'PR Constitution Day', type: 'pr', peak_multiplier: 1.3 },
  { date: '2026-09-07', name: 'Labor Day', type: 'us', peak_multiplier: 1.3 },
  { date: '2026-10-12', name: 'Columbus Day', type: 'us', peak_multiplier: 1.1 },
  { date: '2026-11-11', name: 'Veterans Day', type: 'us', peak_multiplier: 1.1 },
  { date: '2026-11-19', name: 'Discovery Day (PR)', type: 'pr', peak_multiplier: 1.2 },
  { date: '2026-11-26', name: 'Thanksgiving', type: 'us', peak_multiplier: 1.3 },
  { date: '2026-12-24', name: 'Christmas Eve', type: 'us', peak_multiplier: 1.5 },
  { date: '2026-12-25', name: 'Christmas Day', type: 'us', peak_multiplier: 1.5 },
  { date: '2026-12-31', name: "New Year's Eve", type: 'us', peak_multiplier: 1.5 },
];

/** Seed holidays into the database */
function seedHolidays(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO holidays (date, name, type, peak_multiplier) VALUES (?, ?, ?, ?)'
  );

  const insertMany = db.transaction((holidays) => {
    for (const h of holidays) {
      insert.run(h.date, h.name, h.type, h.peak_multiplier);
    }
  });

  insertMany(HOLIDAYS_2026);

  // Warn if current year has no holidays in the database
  checkHolidayCoverage(db);

  return HOLIDAYS_2026.length;
}

/**
 * Check if the current year has holidays seeded.
 * Logs a warning if not — the system will silently miss holiday pricing.
 */
function checkHolidayCoverage(db) {
  const currentYear = new Date().getFullYear();
  const count = db.prepare(
    "SELECT COUNT(*) as cnt FROM holidays WHERE date LIKE ?"
  ).get(`${currentYear}-%`);

  if (!count || count.cnt === 0) {
    console.warn(
      `[pricing] WARNING: No holidays found for ${currentYear}. ` +
      `Holiday pricing adjustments will not work. ` +
      `Update tools/pricing/lib/holidays.js with ${currentYear} dates and re-seed.`
    );
  }
}

module.exports = { HOLIDAYS_2026, seedHolidays, checkHolidayCoverage };
