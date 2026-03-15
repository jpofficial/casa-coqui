'use client';

import NotificationSettings from '@/components/guest/NotificationSettings';

export default function NotificationSettingsPage({ params }) {
  const { code } = params;

  return (
    <div className="px-4 pt-5 pb-8">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Notification Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Choose what you want to be alerted about during your stay.
        </p>
      </div>
      <NotificationSettings bookingCode={code} />
    </div>
  );
}
