'use client';

import { useEffect } from 'react';
import useAuth from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function RateCalendarPage() {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user || !['admin', 'cohost'].includes(role)) {
      router.replace('/admin/login');
    }
  }, [user, role, loading, router]);

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (!user || !['admin', 'cohost'].includes(role)) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-xl font-bold">Rate Calendar</h1>
      <p className="text-sm text-gray-500 mt-1">Page scaffold — components coming next.</p>
    </div>
  );
}
