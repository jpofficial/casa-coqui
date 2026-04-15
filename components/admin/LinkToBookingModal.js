'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { t } from '@/lib/i18n';

export default function LinkToBookingModal({ threadKey, guestName, user, locale = 'en', onLinked, onCancel }) {
  const [bookings, setBookings] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const q = query(collection(db, 'bookings'), where('status', '==', 'active'));
        const snap = await getDocs(q);
        setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        setError(err?.message || 'Failed to load bookings.');
      }
    }
    load();
  }, []);

  async function handleLink() {
    if (!selectedId) return;
    setSaving(true);
    setError('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/messages/threads/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ fromThreadKey: threadKey, bookingId: selectedId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json?.error || `link failed: ${res.status}`);
      }
      onLinked(json?.data?.newThreadKey || null);
    } catch (err) {
      setError(err?.message || 'Failed to link thread.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4"
      onClick={() => { if (!saving) onCancel(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !saving) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-booking-dialog-title"
        className="bg-white rounded-2xl max-w-md w-full p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="link-booking-dialog-title" className="text-lg font-semibold text-gray-900 mb-1">
          {t(locale, 'admin_msg_link_title')}
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          {t(locale, 'admin_msg_unmatched_hint')} <b>{guestName}</b>
        </p>
        <select
          className="w-full p-2 border border-gray-300 rounded-lg text-sm"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          autoFocus
        >
          <option value="">—</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.guestName} · {b.checkInDate} → {b.checkOutDate} · {b.unit}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            {t(locale, 'admin_book_markSent_cancel')}
          </button>
          <button
            onClick={handleLink}
            disabled={saving || !selectedId}
            className="px-4 py-2 text-sm bg-coqui-600 text-white rounded-lg font-semibold hover:bg-coqui-700 disabled:opacity-50"
          >
            {saving ? '…' : t(locale, 'admin_msg_link_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
