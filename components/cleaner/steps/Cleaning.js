'use client';

import { t } from '@/lib/i18n';

export default function Cleaning({ locale, onReportIssue, onAdvance, busy }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-coqui-100 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-coqui-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <p className="text-lg font-bold text-gray-900 mb-8">
        {t(locale, 'cleaningInProgress')}
      </p>

      <div className="w-full max-w-sm space-y-4">
        <button
          onClick={onReportIssue}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white text-lg font-bold rounded-2xl px-6 py-4 transition"
        >
          {t(locale, 'reportIssue')}
        </button>

        <button
          onClick={onAdvance}
          disabled={busy}
          className="w-full bg-coqui-600 hover:bg-coqui-700 disabled:bg-coqui-300 text-white text-lg font-bold rounded-2xl px-6 py-4 transition"
        >
          {busy ? t(locale, 'sending') : t(locale, 'readyForPhotos')}
        </button>
      </div>
    </div>
  );
}
