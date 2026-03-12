'use client';

import Community from '@/components/guest/Community';

export default function CommunityPage({ params }) {
  const code = params.code;

  return (
    <div className="px-4 py-5">
      <Community code={code} />
    </div>
  );
}
