'use client';

import { useState } from 'react';
import { collection, addDoc, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollection } from '@/hooks/useFirestore';
import useAuth from '@/hooks/useAuth';
import ImageUpload from '@/components/ui/ImageUpload';

export default function CleaningPage() {
  const { user } = useAuth();

  // Bookings with upcoming checkouts (next 3 days)
  const now = new Date();
  const threeDaysOut = new Date(now);
  threeDaysOut.setDate(threeDaysOut.getDate() + 3);
  const todayStr = now.toISOString().split('T')[0];
  const futureStr = threeDaysOut.toISOString().split('T')[0];

  const { data: bookings, loading: bookingsLoading } = useCollection('bookings', [
    where('checkOutDate', '>=', todayStr),
    where('checkOutDate', '<=', futureStr),
    orderBy('checkOutDate', 'asc'),
  ]);

  const { data: supplies, loading: suppliesLoading } = useCollection('supplies');
  const { data: cleanings } = useCollection('cleanings', [
    orderBy('cleanedAt', 'desc'),
  ]);

  return (
    <div className="p-4 max-w-lg mx-auto space-y-6 pb-8">
      <h1 className="text-xl font-bold text-gray-900">Cleaning Dashboard</h1>

      {/* A. Cleaning Schedule */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">
          Upcoming Checkouts
        </h2>
        {bookingsLoading ? (
          <p className="text-sm text-gray-500">Loading schedule...</p>
        ) : bookings.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <p className="text-sm text-gray-500">No checkouts in the next 3 days.</p>
          </div>
        ) : (
          bookings.map((booking) => {
            const isPast = booking.checkOutDate <= todayStr;
            const alreadyCleaned = cleanings.some(
              (c) => c.bookingId === booking.id
            );
            return (
              <div
                key={booking.id}
                className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {booking.unit || 'Unit'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {booking.guestName || 'Guest'} — Checkout: {booking.checkOutDate}
                  </p>
                </div>
                <div>
                  {alreadyCleaned ? (
                    <span className="text-xs font-semibold bg-green-100 text-green-800 px-2 py-1 rounded-full">
                      Cleaned
                    </span>
                  ) : isPast ? (
                    <span className="text-xs font-semibold bg-red-100 text-red-800 px-2 py-1 rounded-full">
                      Ready to clean
                    </span>
                  ) : (
                    <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                      Upcoming
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* B. Cleaning Confirmation */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">
          Confirm Cleaning
        </h2>
        <CleaningConfirmation user={user} bookings={bookings} cleanings={cleanings} />
      </section>

      {/* C. Supply View + Request */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">Supplies</h2>
        {suppliesLoading ? (
          <p className="text-sm text-gray-500">Loading supplies...</p>
        ) : supplies.length === 0 ? (
          <p className="text-sm text-gray-500">No supplies tracked.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {supplies.map((supply) => {
              const isLow =
                supply.quantity != null &&
                supply.minQuantity != null &&
                supply.quantity <= supply.minQuantity;
              return (
                <div key={supply.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{supply.name}</p>
                    <p className="text-xs text-gray-500">
                      Qty: {supply.quantity ?? '—'}
                    </p>
                  </div>
                  {isLow && (
                    <span className="text-xs font-semibold bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                      Low stock
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <SupplyRequestForm user={user} supplies={supplies} />
      </section>
    </div>
  );
}

function CleaningConfirmation({ user, bookings, cleanings }) {
  const [selectedBooking, setSelectedBooking] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Only show bookings that haven't been cleaned yet
  const uncleanedBookings = bookings.filter(
    (b) => !cleanings.some((c) => c.bookingId === b.id)
  );

  async function handleConfirm() {
    if (!selectedBooking || !photoUrl) return;
    setSubmitting(true);

    const booking = bookings.find((b) => b.id === selectedBooking);
    try {
      await addDoc(collection(db, 'cleanings'), {
        unit: booking?.unit || '',
        cleanedBy: user?.email || user?.uid || 'unknown',
        photoUrl,
        bookingId: selectedBooking,
        cleanedAt: new Date().toISOString(),
      });
      setSuccess(true);
      setSelectedBooking('');
      setPhotoUrl('');
    } catch (err) {
      console.error('Failed to confirm cleaning:', err);
    } finally {
      setSubmitting(false);
    }
  }

  if (uncleanedBookings.length === 0 && !success) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
        <p className="text-sm text-gray-500">No units awaiting confirmation.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      {success && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-800 font-medium">Cleaning confirmed!</p>
        </div>
      )}

      {uncleanedBookings.length > 0 && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Unit
            </label>
            <select
              value={selectedBooking}
              onChange={(e) => {
                setSelectedBooking(e.target.value);
                setSuccess(false);
              }}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Choose...</option>
              {uncleanedBookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.unit || 'Unit'} — {b.guestName || 'Guest'} (checkout {b.checkOutDate})
                </option>
              ))}
            </select>
          </div>

          {selectedBooking && (
            <>
              <ImageUpload
                storagePath="cleanings"
                value={photoUrl}
                onChange={setPhotoUrl}
                label="Photo proof of cleaning"
              />

              <button
                type="button"
                onClick={handleConfirm}
                disabled={!photoUrl || submitting}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition"
              >
                {submitting ? 'Confirming...' : 'Confirm Cleaned'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SupplyRequestForm({ user, supplies }) {
  const [selectedSupply, setSelectedSupply] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleRequest(e) {
    e.preventDefault();
    if (!selectedSupply) return;
    setSubmitting(true);

    const supply = supplies.find((s) => s.id === selectedSupply);
    try {
      await addDoc(collection(db, 'supply_requests'), {
        supplyId: selectedSupply,
        supplyName: supply?.name || '',
        requestedBy: user?.email || user?.uid || 'unknown',
        note,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      setSuccess(true);
      setSelectedSupply('');
      setNote('');
    } catch (err) {
      console.error('Failed to request supply:', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <p className="text-sm font-medium text-gray-700">Request a Supply</p>

      {success && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          Supply request submitted!
        </p>
      )}

      <form onSubmit={handleRequest} className="space-y-3">
        <select
          value={selectedSupply}
          onChange={(e) => {
            setSelectedSupply(e.target.value);
            setSuccess(false);
          }}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">Select supply...</option>
          {supplies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional)"
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

        <button
          type="submit"
          disabled={!selectedSupply || submitting}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition"
        >
          {submitting ? 'Submitting...' : 'Request Supply'}
        </button>
      </form>
    </div>
  );
}
