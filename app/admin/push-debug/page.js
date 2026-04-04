'use client';

import { useState } from 'react';
import useAuth from '@/hooks/useAuth';
import { auth } from '@/lib/firebase';

export default function PushDebugPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function runCheck() {
    setLoading(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin/push-debug', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setData(json);
    } catch (err) {
      setData({ error: err.message });
    }
    setLoading(false);
  }

  if (!user) return <p className="p-4">Loading auth...</p>;

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold mb-4">Push Notification Debug</h1>
      <button
        onClick={runCheck}
        disabled={loading}
        className="bg-coqui-600 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
      >
        {loading ? 'Checking...' : 'Run Diagnostic'}
      </button>
      {data && (
        <pre className="mt-4 bg-gray-100 rounded-lg p-3 text-xs overflow-auto whitespace-pre-wrap">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
