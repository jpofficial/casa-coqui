'use client';

import { useEffect, useMemo, useState } from 'react';
import useAuth from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import UnitToggle from '@/components/admin/pricing/UnitToggle';
import MonthNavigator, { addMonths } from '@/components/admin/pricing/MonthNavigator';
import Legend from '@/components/admin/pricing/Legend';
import CalendarGrid from '@/components/admin/pricing/CalendarGrid';
import SidePanel from '@/components/admin/pricing/SidePanel';
import BottomSheet from '@/components/admin/pricing/BottomSheet';

function todayStrPR() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Puerto_Rico' });
}
function monthFromDate(dateStr) { return dateStr.slice(0, 7); }

export default function RateCalendarPage() {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  const todayStr = useMemo(() => todayStrPR(), []);
  const todayMonth = monthFromDate(todayStr);
  const minMonth = addMonths(todayMonth, -3);
  const maxMonth = addMonths(todayMonth, 6);

  const [unit, setUnit] = useState('unit-a');
  const [month, setMonth] = useState(todayMonth);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [monthData, setMonthData] = useState(null);
  const [dayData, setDayData] = useState(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user || !role === 'admin') router.replace('/admin/login');
  }, [user, role, loading, router]);

  // Fetch month data whenever unit or month changes
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/api/pricing/calendar?unit=${unit}&month=${month}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!cancelled && json.success) setMonthData(json.data);
      } catch (err) {
        console.error('[rate-calendar] month fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [unit, month, user]);

  // Fetch day data whenever selectedDate or unit changes
  useEffect(() => {
    if (!user || !selectedDate) return;
    let cancelled = false;
    setDayLoading(true);
    setDayData(null);
    (async () => {
      try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch(`/api/pricing/calendar/day?unit=${unit}&date=${selectedDate}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!cancelled && json.success) setDayData(json.data);
      } catch (err) {
        if (!cancelled) console.error('[rate-calendar] day fetch failed:', err);
      } finally {
        if (!cancelled) setDayLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [unit, selectedDate, user]);

  const handleSelect = (date) => {
    setSelectedDate(date);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setSheetOpen(true);
    }
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (!user || !role === 'admin') return null;

  const days = monthData?.days || [];
  const lastRun = monthData?.lastRun;
  const compSet = monthData?.compSet;

  const compSetHeaderMeta = compSet && compSet.count > 0
    ? `${compSet.count} comps${compSet.minBedrooms === compSet.maxBedrooms
        ? ` · ${compSet.minBedrooms} BR`
        : ` · ${compSet.minBedrooms}–${compSet.maxBedrooms} BR`}`
    : '';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar / breadcrumb */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-white">
        <div className="text-sm text-gray-500">Admin · Pricing · <span className="text-gray-900 font-semibold">Rate Calendar</span></div>
        <div className="text-xs text-gray-500">
          {lastRun ? `Last sync: ${new Date(lastRun.started_at).toLocaleString('en-US')}${compSetHeaderMeta ? ' · ' + compSetHeaderMeta : ''}` : '—'}
        </div>
      </div>

      {/* Page header */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 bg-white">
        <h1 className="text-2xl font-extrabold tracking-tight">Rate Calendar</h1>
        <p className="text-sm text-gray-500 mt-1">What each night should be priced at, based on current market research. Tap any day for the reasoning.</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-gray-50/60 border-b border-gray-100">
        <UnitToggle unit={unit} onChange={setUnit} />
        <MonthNavigator
          month={month}
          onChange={(m) => { setMonth(m); }}
          todayMonth={todayMonth}
          minMonth={minMonth}
          maxMonth={maxMonth}
        />
        <Legend />
      </div>

      {/* Body */}
      <div className="grid md:grid-cols-[1fr_360px] min-h-[620px]">
        <div className="p-6">
          <CalendarGrid
            month={month}
            days={days}
            selectedDate={selectedDate}
            todayStr={todayStr}
            onSelect={handleSelect}
          />
        </div>
        <div className="hidden md:block border-l border-gray-100 bg-white">
          <SidePanel unit={unit} date={selectedDate} payload={dayData} loading={dayLoading} compSet={compSet} />
        </div>
      </div>

      {/* Mobile bottom sheet */}
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
        <SidePanel unit={unit} date={selectedDate} payload={dayData} loading={dayLoading} compSet={compSet} />
      </BottomSheet>
    </div>
  );
}
