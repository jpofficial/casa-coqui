'use client';

import { where } from 'firebase/firestore';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import Parking from '@/components/guest/Parking';

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function ParkingSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="h-6 bg-gray-200 rounded w-1/3" />
      <div className="h-4 bg-gray-100 rounded w-2/3" />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
        <div className="h-48 bg-gray-100 rounded-xl" />
      </div>
      <div className="h-16 bg-gray-100 rounded-xl" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ParkingPage({ params }) {
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
        <ParkingSkeleton />
      ) : (
        <Parking bookingData={bookingData} settings={settings} />
      )}
    </div>
  );
}
