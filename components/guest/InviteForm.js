'use client';

import { useState } from 'react';
import { auth } from '@/lib/firebase';

export default function InviteForm({ code, onSent }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/guests/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error || 'Failed to send invite.');
        return;
      }

      setName('');
      setEmail('');
      if (onSent) onSent();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-sm font-semibold text-gray-900">Invite a guest</p>
      <input
        type="text"
        placeholder="Guest name"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(''); }}
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400
          focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
      />
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(''); }}
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400
          focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm
          hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? 'Sending...' : 'Send Invite'}
      </button>
    </form>
  );
}
