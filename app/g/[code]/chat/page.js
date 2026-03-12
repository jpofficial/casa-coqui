'use client';

import Chat from '@/components/guest/Chat';

export default function ChatPage({ params }) {
  const code = params.code;

  return (
    <div className="px-4 py-5">
      <Chat code={code} />
    </div>
  );
}
