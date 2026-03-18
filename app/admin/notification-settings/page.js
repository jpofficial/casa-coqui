'use client';

import useAuth from '@/hooks/useAuth';
import StaffNotificationSettings from '@/components/admin/StaffNotificationSettings';

export default function StaffNotificationSettingsPage() {
  const { user } = useAuth();
  if (!user) return null;
  return <StaffNotificationSettings staffId={user.uid} />;
}
