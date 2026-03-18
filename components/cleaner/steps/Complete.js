'use client';

import { t } from '@/lib/i18n';

export default function Complete({ job, locale, onFinish }) {
  const beforeCount = job.beforePhotos?.length || 0;
  const afterCount = job.afterPhotos?.length || 0;
  const issueCount = job.issues?.length || 0;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-coqui-100 flex items-center justify-center mb-4">
        <svg className="w-10 h-10 text-coqui-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        {t(locale, 'cleaningComplete')}
      </h2>

      <div className="bg-white rounded-2xl border border-cafe-200 p-5 w-full max-w-sm text-left space-y-3 mb-8">
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">{t(locale, 'unit')}</span>
          <span className="text-sm font-medium text-gray-900">{job.unit}</span>
        </div>
        {job.startedAt && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">{t(locale, 'timeStarted')}</span>
            <span className="text-sm font-medium text-gray-900">
              {new Date(job.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
        {job.completedAt && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">{t(locale, 'timeCompleted')}</span>
            <span className="text-sm font-medium text-gray-900">
              {new Date(job.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-sm text-gray-500">{t(locale, 'photosTaken')}</span>
          <span className="text-sm font-medium text-gray-900">{beforeCount + afterCount}</span>
        </div>
        {issueCount > 0 && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">{t(locale, 'issuesReported')}</span>
            <span className="text-sm font-medium text-amber-700">{issueCount}</span>
          </div>
        )}
      </div>

      <button
        onClick={onFinish}
        className="w-full max-w-sm bg-coqui-600 hover:bg-coqui-700 text-white text-lg font-bold rounded-2xl px-6 py-4 transition"
      >
        {t(locale, 'finish')}
      </button>
    </div>
  );
}
