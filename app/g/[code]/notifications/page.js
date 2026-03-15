'use client';

import NotificationCenter from '@/components/guest/NotificationCenter';

export default function NotificationsPage({ params }) {
  const { code } = params;

  return (
    <div className="px-4 pt-4 pb-6">
      <NotificationCenter code={code} bookingCode={code} />
    </div>
  );
}
