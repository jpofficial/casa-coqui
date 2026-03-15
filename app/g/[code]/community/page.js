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

  // Pre-stay gate: if guest's reservation hasn't started yet, show a warm message
  const today = new Date().toISOString().slice(0, 10);
  const isPreStay = datesLoaded && dateFrom && today < dateFrom;

  if (isPreStay) {
    // Format the check-in date for display
    const [y, m, d] = dateFrom.split('-').map(Number);
    const checkInDisplay = new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    return (
      <div className="flex flex-col items-center text-center pt-12 pb-8 px-2">
        <div className="w-16 h-16 rounded-2xl bg-coqui-50 flex items-center justify-center mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-coqui-400" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-coqui-900 mb-1.5">Community Board</h2>
        <p className="text-sm text-coqui-800/60 leading-relaxed max-w-xs">
          The community board opens when your stay begins on <span className="font-medium text-coqui-800">{checkInDisplay}</span>.
        </p>
        <p className="text-xs text-coqui-800/40 mt-3">
          You&apos;ll be able to coordinate parking, laundry, and more with fellow guests.
        </p>
      </div>
    );
  }

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
