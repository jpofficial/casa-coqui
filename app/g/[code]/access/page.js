'use client';

import { where } from 'firebase/firestore';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import AccessCodes from '@/components/guest/AccessCodes';
import CheckInGuide from '@/components/guest/CheckInGuide';

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function AccessSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="h-6 bg-gray-200 rounded w-1/3" />
      <div className="h-4 bg-gray-100 rounded w-2/3" />
      <div className="h-10 bg-amber-50 rounded-xl border border-amber-100" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-200 rounded-lg" />
            <div className="h-4 bg-gray-200 rounded w-1/4" />
          </div>
          <div className="h-12 bg-gray-50 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AccessPage({ params }) {
  const code = params.code;

  const { data: bookings, loading: bookingsLoading } = useCollection('bookings', [
    where('code', '==', code),
  ]);
  const { data: settings, loading: settingsLoading } = useDocument('settings', 'property');

  const bookingData = bookings?.[0] ?? null;
  const loading = bookingsLoading || settingsLoading;

  return (
    <div className="px-4 py-5">
      {loading ? (
        <AccessSkeleton />
      ) : (
        <div className="flex flex-col gap-6">
          <CheckInGuide settings={settings} booking={bookingData} />
          <AccessCodes bookingData={bookingData} settings={settings} />
        </div>
      )}
    </div>
  );
}
