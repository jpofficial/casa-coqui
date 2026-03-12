'use client';

import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex flex-col items-center justify-center px-4">
      <div className="text-center space-y-6 max-w-md w-full">
        {/* Logo / Brand */}
        <div className="space-y-2">
          <div className="w-16 h-16 bg-green-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Casa Coqui</h1>
          <p className="text-gray-500 text-sm">Guest Portal & Property Management</p>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={() => router.push('/admin/login')}
            className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-xl px-4 py-4 text-sm transition-colors min-h-[48px] shadow-sm"
          >
            Admin Login
          </button>
          <p className="text-xs text-gray-400 pt-2">
            Guests: use the link provided by your host to access your portal.
          </p>
        </div>
      </div>
    </div>
  );
}
