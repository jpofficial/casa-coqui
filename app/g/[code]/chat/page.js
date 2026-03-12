'use client';

import Chat from '@/components/guest/Chat';

export default function ChatPage({ params }) {
  const code = params.code;

  return (
    <div className="px-4 py-5 h-[calc(100dvh-120px)]">
      <Chat code={code} />
    </div>
  );
}
