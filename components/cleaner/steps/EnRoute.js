'use client';

import { t } from '@/lib/i18n';

export default function EnRoute({ job, locale, onAdvance, busy }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <p className="text-base text-gray-500 mb-2">{job.unit}</p>

      {job.turnoverNotes && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-8 w-full max-w-sm text-left">
          <p className="text-sm text-gray-500 mb-1">{t(locale, 'notes')}</p>
          <p className="text-sm text-gray-700">{job.turnoverNotes}</p>
        </div>
      )}

      <button
        onClick={onAdvance}
        disabled={busy}
        className="w-full max-w-sm bg-coqui-600 hover:bg-coqui-700 disabled:bg-coqui-300 text-white text-xl font-bold rounded-2xl px-6 py-6 transition"
      >
        {busy ? t(locale, 'sending') : t(locale, 'onMyWay')}
      </button>
    </div>
  );
}
