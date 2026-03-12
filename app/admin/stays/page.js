'use client';

import { useState, useEffect } from 'react';
import useAuth from '@/hooks/useAuth';

export default function StaysPage() {
  const { user } = useAuth();
  const [stays, setStays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchStays() {
      if (!user) return;
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/stays/active', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const json = await res.json();
        if (json.success) {
          setStays(json.data);
        } else {
          setError(json.error);
        }
      } catch (err) {
        setError('Failed to load stays.');
      } finally {
        setLoading(false);
      }
    }
    fetchStays();
  }, [user]);

  if (loading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-center text-red-500">{error}</div>;
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Current Stays</h1>

      {stays.length === 0 ? (
        <div className="text-center text-gray-500 py-12">
          <p className="text-lg font-medium">No active stays</p>
          <p className="text-sm mt-1">There are no guests currently checked in.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {stays.map((stay) => (
            <div
              key={stay.id}
              className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-gray-900">{stay.unit}</span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    stay.checkedIn
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {stay.checkedIn ? 'Checked In' : 'Expected'}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-1">{stay.guestFirstName}</p>
              <p className="text-xs text-gray-400">
                {formatDate(stay.checkInDate)} — {formatDate(stay.checkOutDate)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
