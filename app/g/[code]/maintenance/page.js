'use client';

import MaintenanceForm from '@/components/guest/MaintenanceForm';

export default function MaintenancePage({ params }) {
  const code = params.code;

  return (
    <div className="px-4 py-5">
      <MaintenanceForm code={code} />
    </div>
  );
}
