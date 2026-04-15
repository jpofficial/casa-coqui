'use client';

import { useState, useMemo } from 'react';
import { orderBy } from 'firebase/firestore';
import Link from 'next/link';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { getUnitNames } from '@/lib/units';
import useAuth from '@/hooks/useAuth';
import {
  ymd,
  dateToYMD,
  formatMonthYear,
  formatDateFull,
  formatDateShort,
  getNightCount,
  bookingStatus,
  buildCalendarGrid,
  bookingDaysInMonth,
  getUnitPalette,
  UNIT_PALETTES,
  CLEANING_STATUS_COLORS,
  CLEANING_STATUS_LABELS,
  TODAY,
  buildAgendaForWindow,
  buildWarningList,
} from '@/lib/calendar-helpers';

// ---------------------------------------------------------------------------
// Unified Operational Calendar
//
// Shows booking spans + cleaning jobs + conflict indicators in one view.
// Replaces the separate occupancy calendar and admin cleaning calendar.
// ---------------------------------------------------------------------------

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// ---------------------------------------------------------------------------
// Calendar Day Cell
// ---------------------------------------------------------------------------

function CalendarDayCell({ cell, dayData, isToday, isSelected, onTap, unitNames }) {
  if (!cell) return <div className="min-h-[58px]" />;

  const { bookings = [], conflicts = [] } = dayData || {};
  const hasConflict = conflicts.length > 0;

  // For each unit (by index), is that unit occupied this day?
  // Checkout day does not count as "occupied" — guest departs.
  const unitOccupied = unitNames.map((name) =>
    bookings.some((b) => b.booking.unit === name && !b.isCheckOut)
  );

  return (
    <button
      onClick={() => onTap(cell.dateStr)}
      className={`relative min-h-[58px] rounded-lg p-1.5 w-full text-left transition-colors ${
        isSelected ? 'ring-2 ring-green-500' : ''
      } ${hasConflict ? 'ring-1 ring-red-400' : ''}`}
    >
      {/* Warning dot (top-right) */}
      {hasConflict && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
      )}

      {/* Day number */}
      <div className="flex justify-center mb-1.5">
        <span
          className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
            isToday ? 'bg-green-600 text-white font-bold' : 'text-gray-600'
          }`}
        >
          {cell.dayNum}
        </span>
      </div>

      {/* Two stacked unit pills */}
      <div className="flex flex-col gap-1 px-0.5">
        {unitNames.map((_, unitIdx) => {
          const palette = UNIT_PALETTES[unitIdx % UNIT_PALETTES.length];
          const filled = unitOccupied[unitIdx];
          return (
            <div
              key={unitIdx}
              className={`h-[6px] rounded ${filled ? palette.bar.active : 'bg-gray-100'}`}
            />
          );
        })}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Day Detail Sheet (bottom sheet)
// ---------------------------------------------------------------------------

function DayDetailSheet({ dateStr, dayData, unitNames, onClose }) {
  const { bookings = [], cleaningJobs = [], conflicts = [] } = dayData || {};
  const activeJobs = cleaningJobs.filter((j) => !['cancelled', 'deleted', 'archived'].includes(j.status));

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl w-full max-w-lg max-h-[75vh] overflow-y-auto shadow-xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div className="px-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">{formatDateFull(dateStr)}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-4">
          {/* Warnings */}
          {conflicts.length > 0 && (
            <div className="space-y-2">
              {conflicts.map((c, i) => (
                <div key={i} className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
                  <span>⚠</span>
                  <div className="flex-1">
                    <div className="font-semibold">{c.message}</div>
                    <Link href={c.fixHref} className="mt-1 inline-block underline font-semibold">
                      {c.kind === 'missing_cleaning' ? 'Schedule cleaning →' : 'Fix date →'}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reservations */}
          {bookings.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Reservations</h4>
              <div className="space-y-2">
                {bookings.map(({ booking, status, isCheckIn, isCheckOut }) => {
                  const palette = getUnitPalette(booking.unit, unitNames);
                  const ci = ymd(booking.checkInDate);
                  const co = ymd(booking.checkOutDate);
                  const nights = getNightCount(ci, co);
                  const statusLabel = isCheckIn ? 'Check-in' : isCheckOut ? 'Check-out' : status === 'active' ? 'Active' : status === 'upcoming' ? 'Upcoming' : 'Past';
                  const statusCls = isCheckIn ? 'bg-blue-100 text-blue-700' : isCheckOut ? 'bg-red-100 text-red-700' : status === 'active' ? 'bg-green-100 text-green-700' : status === 'upcoming' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500';

                  return (
                    <div key={`${booking.id}-${isCheckIn}-${isCheckOut}`} className={`border-l-[3px] ${palette.accent.active} rounded-r-lg bg-gray-50 p-3`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-900">{booking.guestName || 'Guest'}</span>
                        <div className="flex items-center gap-1.5">
                          {booking.source === 'airbnb' && (
                            <span className="text-[10px] font-semibold bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded">Airbnb</span>
                          )}
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusCls}`}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={`font-medium ${palette.text}`}>{booking.unit}</span>
                        <span>·</span>
                        <span>{formatDateShort(ci)} → {formatDateShort(co)}</span>
                        <span>·</span>
                        <span>{nights} night{nights !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cleaning */}
          {activeJobs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Cleaning</h4>
              <div className="space-y-2">
                {activeJobs.map((job) => {
                  const palette = getUnitPalette(job.unit, unitNames);
                  return (
                    <Link
                      key={job.id}
                      href={`/admin/cleaning#job-${job.id}`}
                      className={`block border-l-[3px] ${palette.accent.active} rounded-r-lg bg-gray-50 p-3 hover:bg-gray-100 transition`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${CLEANING_STATUS_COLORS[job.status] || 'bg-gray-400'}`} />
                          <span className="text-sm font-semibold text-gray-900">
                            {CLEANING_STATUS_LABELS[job.status] || job.status}
                          </span>
                        </div>
                        {job.manualOverride && (
                          <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Pinned</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={`font-medium ${palette.text}`}>{job.unit}</span>
                        <span>·</span>
                        <span>Checkout {job.checkoutTime || '11:00 AM'}</span>
                        <span>·</span>
                        <span>{job.assigneeName || 'Unassigned'}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {bookings.length === 0 && activeJobs.length === 0 && conflicts.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">No activity on this date</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar Legend
// ---------------------------------------------------------------------------

function CalendarLegend({ unitNames }) {
  return (
    <div className="border-t border-gray-100 pt-3 px-1 flex flex-wrap gap-3 text-[11px] text-gray-500">
      {unitNames.map((name, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <span className={`w-4 h-1.5 rounded ${UNIT_PALETTES[idx % UNIT_PALETTES.length].bar.active}`} />
          <span>{name}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        <span>Warning</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda View
// ---------------------------------------------------------------------------

function AgendaView({ warnings, agendaDays, unitNames, todayStr, tomorrowStr }) {
  function dayLabel(dateStr) {
    if (dateStr === todayStr) return `Today · ${formatDateFull(dateStr)}`;
    if (dateStr === tomorrowStr) return `Tomorrow · ${formatDateFull(dateStr)}`;
    return formatDateFull(dateStr);
  }

  if (warnings.length === 0 && agendaDays.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-6 text-center">
        <p className="text-sm text-gray-400">Nothing scheduled in the next 14 days.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <div className="flex flex-col gap-2">
          {warnings.map((w, i) => (
            <div key={i} className="bg-red-50 border border-red-200 border-l-[3px] border-l-red-500 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-red-800">
                  ⚠ {w.kind === 'missing_cleaning' ? 'No cleaning scheduled' : 'Cleaning date mismatch'}
                </span>
                <span className="text-xs text-red-600">{formatDateShort(w.dateStr)}</span>
              </div>
              <p className="text-xs text-red-700">{w.message}</p>
              <Link
                href={w.fixHref}
                className="mt-1.5 inline-block text-xs font-semibold text-red-700 hover:text-red-800 underline"
              >
                {w.kind === 'missing_cleaning' ? 'Schedule cleaning →' : 'Fix date →'}
              </Link>
            </div>
          ))}
        </div>
      )}

      {agendaDays.map(({ dateStr, events }) => (
        <div key={dateStr}>
          <h3 className={`text-[10px] font-bold uppercase tracking-wider mb-2 px-0.5 ${
            dateStr === todayStr ? 'text-green-700' : 'text-gray-400'
          }`}>
            {dayLabel(dateStr)}
          </h3>
          <div className="flex flex-col gap-2">
            {events.map((ev, i) => (
              <AgendaEventCard key={i} event={ev} unitNames={unitNames} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgendaEventCard({ event, unitNames }) {
  const palette = getUnitPalette(event.unit, unitNames);
  const accent = palette.accent.active;

  let title;
  const badges = [];
  let meta;

  if (event.kind === 'check_in') {
    title = event.guestName;
    badges.push({ label: 'Check-in', className: 'bg-blue-100 text-blue-700' });
    if (event.source === 'airbnb') badges.push({ label: 'Airbnb', className: 'bg-pink-100 text-pink-700' });
    meta = `${event.unit} · ${event.checkInTime || '4:00 PM'} · ${event.nights} night${event.nights !== 1 ? 's' : ''}`;
  } else if (event.kind === 'check_out') {
    title = event.guestName;
    badges.push({ label: 'Check-out', className: 'bg-red-100 text-red-700' });
    if (event.source === 'airbnb') badges.push({ label: 'Airbnb', className: 'bg-pink-100 text-pink-700' });
    meta = `${event.unit} · 11:00 AM · ${event.nights} night${event.nights !== 1 ? 's' : ''}`;
  } else {
    title = `${event.unit} cleaning`;
    const label = CLEANING_STATUS_LABELS[event.status] || event.status;
    const cls = event.status === 'completed'
      ? 'bg-green-100 text-green-700'
      : event.status === 'scheduled'
      ? 'bg-gray-100 text-gray-600'
      : 'bg-amber-100 text-amber-800';
    badges.push({ label, className: cls });
    meta = `${event.assigneeName || 'Unassigned'} · checkout ${event.checkoutTime || '11:00 AM'}`;
  }

  const href = event.kind === 'cleaning'
    ? `/admin/cleaning#job-${event.cleaningJobId}`
    : `/admin/bookings#booking-${event.bookingId}`;

  return (
    <Link
      href={href}
      className={`block bg-white border-l-[3px] ${accent} rounded-r-lg shadow-sm hover:shadow-md transition p-3`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-gray-900">{title}</span>
        <div className="flex gap-1.5">
          {badges.map((b, i) => (
            <span key={i} className={`text-[10px] font-semibold px-2 py-0.5 rounded ${b.className}`}>
              {b.label}
            </span>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500">{meta}</p>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main Calendar Page
// ---------------------------------------------------------------------------

export default function OperationalCalendar() {
  const { data: bookings, loading: bookingsLoading } = useCollection('bookings', [orderBy('checkInDate', 'asc')]);
  const { data: cleaningJobs, loading: jobsLoading } = useCollection('cleaning_jobs', [orderBy('scheduledDate', 'asc')]);
  const { data: settings } = useDocument('settings', 'property');
  useAuth();
  const unitNames = getUnitNames(settings);

  const now = new Date();
  const [view, setView] = useState('agenda');
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [unitFilter, setUnitFilter] = useState('All');

  const loading = bookingsLoading || jobsLoading;
  const todayStr = TODAY;
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return dateToYMD(d);
  }, []);

  const filteredBookings = useMemo(() => {
    let filtered = bookings.filter((b) => b.status !== 'cancelled');
    if (unitFilter !== 'All') filtered = filtered.filter((b) => b.unit === unitFilter);
    return filtered;
  }, [bookings, unitFilter]);

  const filteredJobs = useMemo(() => {
    let filtered = cleaningJobs;
    if (unitFilter !== 'All') filtered = filtered.filter((j) => j.unit === unitFilter);
    return filtered;
  }, [cleaningJobs, unitFilter]);

  const AGENDA_WINDOW_DAYS = 14;
  const agendaDays = useMemo(
    () => buildAgendaForWindow(filteredBookings, filteredJobs, todayStr, AGENDA_WINDOW_DAYS),
    [filteredBookings, filteredJobs, todayStr]
  );

  const agendaWarnings = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + AGENDA_WINDOW_DAYS - 1);
    const windowEnd = dateToYMD(d);
    const list = buildWarningList(bookings, cleaningJobs, unitNames, todayStr, windowEnd);
    return unitFilter === 'All' ? list : list.filter((w) => w.unit === unitFilter);
  }, [bookings, cleaningJobs, unitNames, todayStr, unitFilter]);

  const calendarGrid = useMemo(
    () => buildCalendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const dayDataMap = useMemo(() => {
    const map = {};
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const monthStart = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
    const monthEnd = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      map[dateStr] = { bookings: [], cleaningJobs: [], conflicts: [] };
    }

    for (const booking of filteredBookings) {
      const range = bookingDaysInMonth(booking, viewYear, viewMonth);
      if (!range) continue;
      const status = bookingStatus(booking);
      const ci = ymd(booking.checkInDate);
      const co = ymd(booking.checkOutDate);

      for (let d = range.startDay; d <= range.endDay; d++) {
        const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (map[dateStr]) {
          map[dateStr].bookings.push({ booking, status, isCheckIn: dateStr === ci, isCheckOut: false });
        }
      }

      const coMonth = parseInt(co.split('-')[1], 10) - 1;
      const coYear = parseInt(co.split('-')[0], 10);
      if (coYear === viewYear && coMonth === viewMonth && map[co]) {
        map[co].bookings.push({ booking, status, isCheckIn: false, isCheckOut: true });
      }
    }

    for (const job of filteredJobs) {
      if (map[job.scheduledDate]) map[job.scheduledDate].cleaningJobs.push(job);
    }

    const monthWarnings = buildWarningList(bookings, filteredJobs, unitNames, monthStart, monthEnd);
    for (const w of monthWarnings) {
      if (map[w.dateStr]) map[w.dateStr].conflicts.push(w);
    }

    return map;
  }, [filteredBookings, filteredJobs, bookings, viewYear, viewMonth, unitNames]);

  const monthConflictCount = useMemo(
    () => Object.values(dayDataMap).reduce((sum, d) => sum + d.conflicts.length, 0),
    [dayDataMap]
  );

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }
  function goToToday() {
    const n = new Date();
    setViewYear(n.getFullYear());
    setViewMonth(n.getMonth());
  }
  function handleDayTap(dateStr) {
    setSelectedDate(selectedDate === dateStr ? null : dateStr);
  }

  if (loading) {
    return (
      <div className="px-4 py-6 flex flex-col gap-4 animate-pulse">
        <div className="h-7 bg-gray-200 rounded w-1/3" />
        <div className="h-80 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Calendar</h1>
        <p className="text-sm text-gray-500">Reservations, checkouts, and cleaning jobs</p>
      </div>

      {/* Agenda / Calendar segmented toggle */}
      <div className="flex bg-gray-100 rounded-full p-1">
        {[
          { key: 'agenda', label: 'Agenda' },
          { key: 'calendar', label: 'Calendar' },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setView(opt.key)}
            className={`flex-1 py-2 text-sm font-semibold rounded-full transition ${
              view === opt.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Unit filter */}
      <div className="flex gap-2">
        {['All', ...unitNames].map((label) => (
          <button
            key={label}
            onClick={() => setUnitFilter(label)}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${
              unitFilter === label ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'agenda' ? (
        <AgendaView
          warnings={agendaWarnings}
          agendaDays={agendaDays}
          unitNames={unitNames}
          todayStr={todayStr}
          tomorrowStr={tomorrowStr}
        />
      ) : (
        <>
          {monthConflictCount > 0 && (
            <button
              onClick={() => setView('agenda')}
              className="w-full bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2 hover:bg-red-100 transition"
            >
              <span>⚠</span>
              <span className="flex-1 text-left">{monthConflictCount} warning{monthConflictCount !== 1 ? 's' : ''} this month</span>
              <span>→</span>
            </button>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              </button>
              <button onClick={goToToday} className="text-sm font-bold text-gray-900 hover:text-green-700 transition">
                {formatMonthYear(viewYear, viewMonth)}
              </button>
              <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition min-w-[44px] min-h-[44px] flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
              </button>
            </div>

            <div className="grid grid-cols-7 border-b border-gray-100">
              {DAY_HEADERS.map((d) => (
                <div key={d} className="text-center py-2 text-[10px] font-semibold text-gray-400 uppercase">{d}</div>
              ))}
            </div>

            <div className="p-1">
              {calendarGrid.map((row, rowIdx) => (
                <div key={rowIdx} className="grid grid-cols-7">
                  {row.map((cell, cellIdx) => (
                    <CalendarDayCell
                      key={cellIdx}
                      cell={cell}
                      dayData={cell ? dayDataMap[cell.dateStr] : null}
                      isToday={cell?.dateStr === TODAY}
                      isSelected={cell?.dateStr === selectedDate}
                      onTap={handleDayTap}
                      unitNames={unitNames}
                    />
                  ))}
                </div>
              ))}
            </div>

            <div className="px-3 pb-3">
              <CalendarLegend unitNames={unitNames} />
            </div>
          </div>

          {selectedDate && dayDataMap[selectedDate] && (
            <DayDetailSheet
              dateStr={selectedDate}
              dayData={dayDataMap[selectedDate]}
              unitNames={unitNames}
              onClose={() => setSelectedDate(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
