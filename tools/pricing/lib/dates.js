const { getHoliday } = require('./db');

/**
 * Get the day-of-week classification for a date string (YYYY-MM-DD).
 * Returns: 'friday' | 'saturday' | 'sunday' | 'weekday'
 */
function getDayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00'); // noon to avoid timezone issues
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  switch (dow) {
    case 0: return 'sunday';
    case 5: return 'friday';
    case 6: return 'saturday';
    default: return 'weekday';
  }
}

/**
 * Check if a date is a holiday. Returns the holiday object or null.
 */
function isHoliday(dateStr) {
  return getHoliday(dateStr) || null;
}

/**
 * Classify a date string (YYYY-MM-DD) into a day type.
 * Backward-compat wrapper — returns 'holiday' for holidays.
 * New code should use getDayOfWeek() + isHoliday() separately.
 */
function classifyDayType(dateStr) {
  const holiday = getHoliday(dateStr);
  if (holiday) return 'holiday';
  return getDayOfWeek(dateStr);
}

/**
 * Generate an array of date strings for the next N days from a start date.
 */
function generateDateRange(startDate, days) {
  const dates = [];
  const start = new Date(startDate + 'T12:00:00');
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

/**
 * Get the next N weekends (Friday + Saturday pairs) from a start date.
 */
function getNextWeekends(startDate, count = 8) {
  const weekends = [];
  const d = new Date(startDate + 'T12:00:00');

  // Advance to next Friday
  while (d.getDay() !== 5) {
    d.setDate(d.getDate() + 1);
  }

  for (let i = 0; i < count; i++) {
    const fri = new Date(d);
    const sat = new Date(d);
    sat.setDate(sat.getDate() + 1);
    weekends.push({
      friday: fri.toISOString().split('T')[0],
      saturday: sat.toISOString().split('T')[0],
    });
    d.setDate(d.getDate() + 7);
  }
  return weekends;
}

/**
 * Format a date string as "Mon DD" (e.g., "Apr 04")
 */
function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${months[d.getMonth()]} ${d.getDate()} ${days[d.getDay()]}`;
}

module.exports = { classifyDayType, getDayOfWeek, isHoliday, generateDateRange, getNextWeekends, formatShortDate };
