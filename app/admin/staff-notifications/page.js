'use client';

import useAuth from '@/hooks/useAuth';
import StaffNotificationCenter from '@/components/admin/StaffNotificationCenter';

export default function StaffNotificationsPage() {
  const { user } = useAuth();

  if (!user) return null;

  return <StaffNotificationCenter staffId={user.uid} />;
}
