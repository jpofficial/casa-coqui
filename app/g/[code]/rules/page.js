'use client';

import { useDocument } from '@/hooks/useFirestore';
import Rules from '@/components/guest/Rules';

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function RulesSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      <div className="h-6 bg-gray-200 rounded w-1/3" />
      <div className="h-4 bg-gray-100 rounded w-1/2" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 bg-gray-100 rounded-xl" />
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function RulesPage({ params }) {
  const { data: settings, loading } = useDocument('settings', 'property');

  return (
    <div className="px-4 py-5">
      {loading ? (
        <RulesSkeleton />
      ) : (
        <Rules settings={settings} />
      )}
    </div>
  );
}
