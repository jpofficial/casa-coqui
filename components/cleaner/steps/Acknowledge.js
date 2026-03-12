'use client';

import { t } from '@/lib/i18n';

export default function Acknowledge({ job, locale, onAdvance, busy }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <p className="text-lg font-semibold text-gray-800 mb-2">
        {t(locale, 'newJobScheduled')}
      </p>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 w-full max-w-sm mb-8 text-left space-y-2">
        <p className="text-sm text-gray-500">{t(locale, 'unit')}</p>
        <p className="text-lg font-bold text-gray-900">{job.unit}</p>

        <p className="text-sm text-gray-500">{t(locale, 'date')}</p>
        <p className="text-base font-medium text-gray-900">{job.scheduledDate}</p>

        <p className="text-sm text-gray-500">{t(locale, 'checkoutTime')}</p>
        <p className="text-base font-medium text-gray-900">{job.checkoutTime || '11:00 AM'}</p>

        {job.sameDayArrival && (
          <p className="text-sm font-medium text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            {t(locale, 'sameDayArrival')}
          </p>
        )}

        {job.turnoverNotes && (
          <>
            <p className="text-sm text-gray-500">{t(locale, 'notes')}</p>
            <p className="text-sm text-gray-700">{job.turnoverNotes}</p>
          </>
        )}
      </div>

      <button
        onClick={onAdvance}
        disabled={busy}
        className="w-full max-w-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-lg font-bold rounded-2xl px-6 py-4 transition"
      >
        {busy ? '...' : t(locale, 'confirm')}
      </button>
    </div>
  );
}
