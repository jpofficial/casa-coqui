'use client';

import Laundry from '@/components/guest/Laundry';

export default function LaundryPage({ params }) {
  const code = params.code;

  return (
    <div className="px-4 py-5">
      <Laundry code={code} />
    </div>
  );
}
