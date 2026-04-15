// ---------------------------------------------------------------------------
// Shared calendar helpers
//
// Used by admin calendar, cleaning page, and cleaner home.
// Extracts common date utilities and calendar grid building logic.
// ---------------------------------------------------------------------------

export function ymd(dateStr) {
  if (!dateStr) return '';
  return String(dateStr).substring(0, 10);
}

export function dateToYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

export function formatMonthYear(year, month) {
  const d = new Date(year, month, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateFull(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function getNightCount(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const [y1, m1, d1] = checkIn.split('-').map(Number);
  const [y2, m2, d2] = checkOut.split('-').map(Number);
  const a = new Date(y1, m1 - 1, d1);
  const b = new Date(y2, m2 - 1, d2);
  const diff = Math.round((b - a) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

export function firstName(name) {
  if (!name) return 'Guest';
  return name.split(' ')[0];
}

export const TODAY = dateToYMD(new Date());

export function bookingStatus(booking) {
  const checkIn = ymd(booking.checkInDate);
  const checkOut = ymd(booking.checkOutDate);
  if (checkOut < TODAY) return 'completed';
  if (checkIn > TODAY) return 'upcoming';
  return 'active';
}

/** Build calendar grid rows for a given month */
export function buildCalendarGrid(year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const cells = [];

  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ dayNum: d, dateStr });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

/**
 * Compute which days a booking occupies in a given month.
 * Checkout date is excluded (guest departs that day, not staying).
 *
 * Returns { startDay, endDay, isStart, isEnd } or null if no overlap.
 */
export function bookingDaysInMonth(booking, year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const checkIn = ymd(booking.checkInDate);
  const checkOut = ymd(booking.checkOutDate);

  if (checkOut <= monthStart || checkIn > monthEnd) return null;

  const clampedStart = checkIn < monthStart ? monthStart : checkIn;
  const clampedEnd = checkOut > monthEnd ? monthEnd : checkOut;

  const startDay = parseInt(clampedStart.split('-')[2], 10);
  let endDay = parseInt(clampedEnd.split('-')[2], 10);

  // If checkout falls within this month, exclude the checkout day itself
  if (checkOut <= monthEnd) {
    endDay = endDay - 1;
  }

  if (endDay < startDay) return null;

  const isStart = checkIn >= monthStart && checkIn <= monthEnd;
  const isEnd = checkOut >= monthStart && checkOut <= monthEnd;

  return { startDay, endDay, isStart, isEnd };
}

// ---------------------------------------------------------------------------
// Color palettes for units and cleaning status
// ---------------------------------------------------------------------------

export const UNIT_PALETTES = [
  {
    name: 'Teal',
    text: 'text-teal-600',
    pill: { active: 'bg-teal-500 text-white', upcoming: 'bg-teal-200 text-teal-800', completed: 'bg-teal-100 text-teal-400' },
    accent: { active: 'bg-teal-500', upcoming: 'bg-teal-300', completed: 'bg-teal-200' },
    bar: { active: 'bg-teal-500', upcoming: 'bg-teal-300', completed: 'bg-teal-200' },
  },
  {
    name: 'Amber',
    text: 'text-amber-600',
    pill: { active: 'bg-amber-500 text-white', upcoming: 'bg-amber-200 text-amber-800', completed: 'bg-amber-100 text-amber-400' },
    accent: { active: 'bg-amber-500', upcoming: 'bg-amber-300', completed: 'bg-amber-200' },
    bar: { active: 'bg-amber-500', upcoming: 'bg-amber-300', completed: 'bg-amber-200' },
  },
];

export function getUnitPalette(unit, unitNames) {
  const idx = unitNames.indexOf(unit);
  return UNIT_PALETTES[idx >= 0 ? idx % UNIT_PALETTES.length : 0];
}

export const CLEANING_STATUS_COLORS = {
  scheduled: 'bg-gray-400',
  acknowledged: 'bg-blue-500',
  declined: 'bg-red-400',
  en_route: 'bg-amber-400',
  arrived: 'bg-amber-500',
  before_photos: 'bg-amber-500',
  cleaning: 'bg-orange-500',
  after_photos: 'bg-orange-500',
  laundry_check: 'bg-orange-500',
  completed: 'bg-green-500',
  cancelled: 'bg-gray-300',
  archived: 'bg-gray-300',
  deleted: 'bg-gray-300',
};

export const CLEANING_STATUS_LABELS = {
  scheduled: 'Scheduled',
  acknowledged: 'Confirmed',
  declined: 'Declined',
  en_route: 'En Route',
  arrived: 'Arrived',
  before_photos: 'In Progress',
  cleaning: 'In Progress',
  after_photos: 'In Progress',
  laundry_check: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

/**
 * Get day context string for a booking on a specific date.
 * e.g. "Check-in", "Checkout", "Night 3 of 5"
 */
export function getDayContext(booking, dateStr) {
  const ci = ymd(booking.checkInDate);
  const co = ymd(booking.checkOutDate);
  if (dateStr === ci) return 'Check-in';
  if (dateStr === co) return 'Checkout';

  const nights = getNightCount(ci, co);
  const nightNum = getNightCount(ci, dateStr);
  if (nightNum > 0 && nightNum <= nights) {
    return `Night ${nightNum} of ${nights}`;
  }
  return '';
}

const TERMINAL_CLEANING_STATUSES = new Set(['cancelled', 'deleted', 'archived']);

/**
 * Build a flat list of operational warnings for a given date window.
 *
 * Emits two kinds:
 *   - missing_cleaning: booking ends on a day in-window with no active cleaning job on that unit+date.
 *   - date_mismatch:    cleaning job in-window whose scheduledDate differs from its linked booking's checkOutDate
 *                       (suppressed if manualOverride is set).
 *
 * Returns: [{ kind, dateStr, unit, bookingId?, cleaningJobId?, message, fixHref }]
 */
export function buildWarningList(bookings, cleaningJobs, unitNames, windowStart, windowEnd) {
  const out = [];
  const activeBookings = bookings.filter((b) => b.status !== 'cancelled');

  // Missing cleaning: booking checkout in-window with no active job on unit+date.
  for (const booking of activeBookings) {
    const checkOut = ymd(booking.checkOutDate);
    if (checkOut < windowStart || checkOut > windowEnd) continue;

    // A cleaning "covers" the checkout only if it's on the same unit + date,
    // OR linked via bookingId without a manualOverride (the date_mismatch
    // loop will surface the date problem separately).
    const sameDayJob = cleaningJobs.some((j) =>
      !TERMINAL_CLEANING_STATUSES.has(j.status) &&
      j.unit === booking.unit &&
      j.scheduledDate === checkOut
    );
    if (sameDayJob) continue;

    const linkedOffDateJob = cleaningJobs.some((j) =>
      !TERMINAL_CLEANING_STATUSES.has(j.status) &&
      j.bookingId === booking.id &&
      !j.manualOverride
    );
    if (linkedOffDateJob) continue;

    out.push({
      kind: 'missing_cleaning',
      dateStr: checkOut,
      unit: booking.unit,
      bookingId: booking.id,
      message: `No cleaning scheduled for ${booking.unit} checkout`,
      fixHref: `/admin/cleaning?new=1&unit=${encodeURIComponent(booking.unit)}&date=${checkOut}&bookingId=${booking.id}`,
    });
  }

  // Date mismatch: active cleaning in-window, linked to a booking whose checkout is a different day.
  for (const job of cleaningJobs) {
    if (TERMINAL_CLEANING_STATUSES.has(job.status)) continue;
    if (!job.bookingId) continue;
    if (job.manualOverride) continue;
    if (job.scheduledDate < windowStart || job.scheduledDate > windowEnd) continue;

    const booking = bookings.find((b) => b.id === job.bookingId);
    if (!booking) continue;
    const bookingCheckout = ymd(booking.checkOutDate);
    if (bookingCheckout === job.scheduledDate) continue;

    out.push({
      kind: 'date_mismatch',
      dateStr: job.scheduledDate,
      unit: job.unit,
      bookingId: booking.id,
      cleaningJobId: job.id,
      message: `Cleaning on ${formatDateShort(job.scheduledDate)} but checkout is ${formatDateShort(bookingCheckout)}`,
      fixHref: `/admin/cleaning#job-${job.id}`,
    });
  }

  return out;
}
