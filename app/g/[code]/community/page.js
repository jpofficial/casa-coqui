'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Community from '@/components/guest/Community';

function CommunityContent({ code }) {
  const searchParams = useSearchParams();
  const initialPostType = searchParams.get('type') || null;

  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [datesLoaded, setDatesLoaded] = useState(false);

  useEffect(() => {
    async function fetchBookingDates() {
      try {
        const q = query(
          collection(db, 'bookings'),
          where('code', '==', code)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const booking = snapshot.docs[0].data();
          setDateFrom(booking.checkInDate || null);
          setDateTo(booking.checkOutDate || null);
        }
      } catch (err) {
        console.error('Failed to fetch booking dates:', err);
      } finally {
        setDatesLoaded(true);
      }
    }

    fetchBookingDates();
  }, [code]);

  if (!datesLoaded) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <div className="w-24 h-5 bg-cafe-200 rounded animate-pulse" />
          <div className="w-48 h-4 bg-cafe-100 rounded mt-2 animate-pulse" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl shadow-brand border border-cafe-100 overflow-hidden animate-pulse">
            <div className="flex items-start gap-3 p-4">
              <div className="w-9 h-9 bg-cafe-200 rounded-full flex-shrink-0" />
              <div className="flex-1 flex flex-col gap-2.5 pt-0.5">
                <div className="w-20 h-3.5 bg-cafe-200 rounded-full" />
                <div className="h-px bg-cafe-100 w-full" />
                <div className="w-full h-3.5 bg-cafe-200 rounded" />
                <div className="w-4/5 h-3.5 bg-cafe-100 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Community
      code={code}
      dateFrom={dateFrom}
      dateTo={dateTo}
      initialPostType={initialPostType}
    />
  );
}

export default function CommunityPage({ params }) {
  const code = params.code;

  return (
    <div className="px-4 py-5">
      <Suspense fallback={
        <div className="flex flex-col gap-4">
          <div>
            <div className="w-24 h-5 bg-cafe-200 rounded animate-pulse" />
            <div className="w-48 h-4 bg-cafe-100 rounded mt-2 animate-pulse" />
          </div>
        </div>
      }>
        <CommunityContent code={code} />
      </Suspense>
    </div>
  );
}
