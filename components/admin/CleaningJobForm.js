'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

const UNITS = [
  { value: 'Casa Coqui Tierra', label: 'Casa Coqui Tierra' },
  { value: 'Casa Coqui Cielo', label: 'Casa Coqui Cielo' },
];

/**
 * CleaningJobForm — modal form for creating ad-hoc cleaning jobs.
 *
 * Props:
 *   open      {boolean}   whether the modal is visible
 *   onClose   {function}  close callback
 *   onCreated {function}  called with the new job data after successful creation
 */
export default function CleaningJobForm({ open, onClose, onCreated }) {
  const [unit, setUnit] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [checkoutTime, setCheckoutTime] = useState('11:00 AM');
  const [assigneeId, setAssigneeId] = useState('');
  const [sameDayArrival, setSameDayArrival] = useState(false);
  const [turnoverNotes, setTurnoverNotes] = useState('');
  const [cleaners, setCleaners] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Fetch active cleaners for the assignee dropdown
  useEffect(() => {
    if (!open) return;
    async function fetchCleaners() {
      try {
        const q = query(
          collection(db, 'users'),
          where('role', '==', 'cleaner'),
          where('status', '==', 'active')
        );
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({
          id: d.id,
          name: d.data().displayName || d.data().email,
        }));
        setCleaners(list);
        if (list.length === 1) setAssigneeId(list[0].id);
      } catch (err) {
        console.error('Failed to fetch cleaners:', err);
      }
    }
    fetchCleaners();
  }, [open]);

  // Reset form when opening
  useEffect(() => {
    if (open) {
      setUnit('');
      setScheduledDate('');
      setCheckoutTime('11:00 AM');
      setSameDayArrival(false);
      setTurnoverNotes('');
      setError('');
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!unit || !scheduledDate || !assigneeId) {
      setError('Unit, date, and assignee are required.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/cleaning/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          unit,
          scheduledDate,
          checkoutTime,
          assigneeId,
          sameDayArrival,
          turnoverNotes,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to create job.');
        setSubmitting(false);
        return;
      }

      onCreated?.(data.data);
      onClose();
    } catch (err) {
      console.error('Create cleaning job error:', err);
      setError('Something went wrong.');
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl mx-auto max-h-[90vh] overflow-y-auto animate-admin-in">
        <div className="px-5 pt-5 pb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">New Cleaning Job</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition p-1"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-4">
          {/* Unit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white
                focus:ring-2 focus:ring-coqui-500 focus:border-coqui-500 outline-none"
              required
            >
              <option value="">Select unit...</option>
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm
                focus:ring-2 focus:ring-coqui-500 focus:border-coqui-500 outline-none"
              required
            />
          </div>

          {/* Checkout Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Checkout Time</label>
            <select
              value={checkoutTime}
              onChange={(e) => setCheckoutTime(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white
                focus:ring-2 focus:ring-coqui-500 focus:border-coqui-500 outline-none"
            >
              <option value="10:00 AM">10:00 AM</option>
              <option value="11:00 AM">11:00 AM</option>
              <option value="12:00 PM">12:00 PM</option>
              <option value="1:00 PM">1:00 PM</option>
              <option value="2:00 PM">2:00 PM</option>
            </select>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assigned Cleaner</label>
            {cleaners.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No active cleaners found.</p>
            ) : (
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white
                  focus:ring-2 focus:ring-coqui-500 focus:border-coqui-500 outline-none"
                required
              >
                {cleaners.length > 1 && <option value="">Select cleaner...</option>}
                {cleaners.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Same-day arrival */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={sameDayArrival}
              onChange={(e) => setSameDayArrival(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-coqui-600 focus:ring-coqui-500"
            />
            <span className="text-sm text-gray-700">Same-day arrival (new guest arriving)</span>
          </label>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Turnover Notes</label>
            <textarea
              value={turnoverNotes}
              onChange={(e) => setTurnoverNotes(e.target.value)}
              rows={2}
              placeholder="Special instructions, guest notes..."
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm resize-none
                focus:ring-2 focus:ring-coqui-500 focus:border-coqui-500 outline-none"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || cleaners.length === 0}
            className="w-full bg-coqui-600 text-white font-semibold py-3 rounded-xl
              hover:bg-coqui-700 active:bg-coqui-800 transition disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Cleaning Job'}
          </button>
        </form>
      </div>
    </div>
  );
}
