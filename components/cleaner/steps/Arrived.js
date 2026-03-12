'use client';

import { t } from '@/lib/i18n';

export default function Arrived({ job, locale, onAdvance, busy }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <p className="text-base text-gray-500 mb-8">{job.unit}</p>

      <button
        onClick={onAdvance}
        disabled={busy}
        className="w-full max-w-sm bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-xl font-bold rounded-2xl px-6 py-6 transition"
      >
        {busy ? '...' : t(locale, 'iArrived')}
      </button>
    </div>
  );
}
