'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Laundry from '@/components/guest/Laundry';

export default function LaundryPage({ params }) {
  const code = params.code;
  const [checkInDate, setCheckInDate] = useState(null);
  const [datesLoaded, setDatesLoaded] = useState(false);

  useEffect(() => {
    async function fetchBookingDates() {
      try {
        const q = query(collection(db, 'bookings'), where('code', '==', code));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const booking = snapshot.docs[0].data();
          setCheckInDate(booking.checkInDate || null);
        }
      } catch (err) {
        console.error('Failed to fetch booking dates:', err);
      } finally {
        setDatesLoaded(true);
      }
    }
    fetchBookingDates();
  }, [code]);

  const today = new Date().toISOString().slice(0, 10);
  const isPreStay = datesLoaded && checkInDate && today < checkInDate;

  return (
    <div className="px-4 py-5">
      <Laundry code={code} readOnly={isPreStay} checkInDate={isPreStay ? checkInDate : null} />
    </div>
  );
}
