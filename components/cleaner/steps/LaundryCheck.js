'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import ImageUpload from '@/components/ui/ImageUpload';

export default function LaundryCheck({ job, locale, onSubmit, busy }) {
  const [found, setFound] = useState(null); // null, true, false
  const [note, setNote] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  function handleSubmit() {
    if (found === null) return;
    onSubmit({
      laundryFound: found,
      laundryNote: found ? note : '',
      laundryPhoto: found ? photoUrl || null : null,
    });
  }

  return (
    <div className="flex flex-col items-center min-h-[60vh] px-6">
      <h2 className="text-lg font-bold text-gray-900 mt-4 mb-4">
        {t(locale, 'laundryCheck')}
      </h2>

      <p className="text-base text-gray-600 text-center mb-8 max-w-sm">
        {t(locale, 'laundryQuestion')}
      </p>

      <div className="w-full max-w-sm space-y-4">
        <div className="grid grid-cols-1 gap-3">
          <button
            onClick={() => setFound(false)}
            className={`rounded-2xl border-2 px-6 py-4 text-base font-bold transition ${
              found === false
                ? 'border-green-600 bg-green-50 text-green-700'
                : 'border-gray-200 bg-white text-gray-700'
            }`}
          >
            {t(locale, 'noAllClean')}
          </button>

          <button
            onClick={() => setFound(true)}
            className={`rounded-2xl border-2 px-6 py-4 text-base font-bold transition ${
              found === true
                ? 'border-amber-600 bg-amber-50 text-amber-700'
                : 'border-gray-200 bg-white text-gray-700'
            }`}
          >
            {t(locale, 'yesSomethingFound')}
          </button>
        </div>

        {found === true && (
          <>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t(locale, 'describeFound')}
              rows={3}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <ImageUpload
              storagePath={`cleaning_jobs/${job.id}/laundry`}
              value={photoUrl}
              onChange={setPhotoUrl}
              label={t(locale, 'takePhoto')}
            />
          </>
        )}

        {found !== null && (
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-lg font-bold rounded-2xl px-6 py-4 transition"
          >
            {busy ? '...' : t(locale, 'continue')}
          </button>
        )}
      </div>
    </div>
  );
}
