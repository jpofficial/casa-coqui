'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';

export default function Acknowledge({ job, locale, onAdvance, onDecline, busy }) {
  const [showDecline, setShowDecline] = useState(false);
  const [reason, setReason] = useState('');
  const [declining, setDeclining] = useState(false);

  async function handleDecline() {
    if (!reason.trim()) return;
    setDeclining(true);
    try {
      await onDecline(reason.trim());
    } catch (_) {
      setDeclining(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <p className="text-lg font-semibold text-gray-800 mb-2">
        {t(locale, 'newJobScheduled')}
      </p>

      <div className="bg-white rounded-2xl border border-cafe-200 p-5 w-full max-w-sm mb-8 text-left space-y-2">
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

      {!showDecline ? (
        <div className="w-full max-w-sm space-y-3">
          <button
            onClick={onAdvance}
            disabled={busy}
            className="w-full bg-coqui-600 hover:bg-coqui-700 disabled:bg-coqui-300 text-white text-lg font-bold rounded-2xl px-6 py-4 transition"
          >
            {busy ? t(locale, 'sending') : t(locale, 'accept')}
          </button>
          <button
            onClick={() => setShowDecline(true)}
            disabled={busy}
            className="w-full bg-white hover:bg-flamboyan-50 disabled:opacity-50 text-flamboyan-600 text-base font-semibold rounded-2xl px-6 py-3 border border-flamboyan-200 transition"
          >
            {t(locale, 'cannotAccept')}
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-3">
          <p className="text-sm font-medium text-gray-700 text-left">
            {t(locale, 'declineReason')}
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(locale, 'declineReasonPlaceholder')}
            rows={3}
            className="w-full rounded-2xl border border-cafe-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-flamboyan-500 focus:border-transparent resize-none"
          />
          <div className="flex gap-3">
            <button
              onClick={handleDecline}
              disabled={declining || !reason.trim()}
              className="flex-1 bg-flamboyan-600 hover:bg-flamboyan-700 disabled:bg-flamboyan-300 text-white text-base font-bold rounded-2xl px-6 py-3 transition"
            >
              {declining ? t(locale, 'sending') : t(locale, 'submitDecline')}
            </button>
            <button
              onClick={() => { setShowDecline(false); setReason(''); }}
              className="flex-1 bg-cafe-100 hover:bg-cafe-200 text-coqui-800 text-base font-semibold rounded-2xl px-6 py-3 transition"
            >
              {t(locale, 'cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
