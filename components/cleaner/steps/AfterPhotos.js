'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import ImageUpload from '@/components/ui/ImageUpload';

export default function AfterPhotos({ job, locale, onPhotosUploaded, busy }) {
  const [urls, setUrls] = useState([]);

  function handlePhotoAdded(url) {
    setUrls((prev) => [...prev, url]);
  }

  return (
    <div className="flex flex-col items-center min-h-[60vh] px-6">
      <h2 className="text-lg font-bold text-gray-900 mt-4 mb-6">
        {t(locale, 'afterPhotos')}
      </h2>

      <div className="w-full max-w-sm space-y-4">
        {urls.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {urls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`After ${i + 1}`}
                className="w-full h-32 object-cover rounded-xl border border-gray-200"
              />
            ))}
          </div>
        )}

        {urls.length < 4 && (
          <ImageUpload
            storagePath={`cleaning_jobs/${job.id}/after`}
            value=""
            onChange={handlePhotoAdded}
            label={t(locale, 'takePhoto')}
          />
        )}

        {urls.length === 0 && (
          <p className="text-sm text-gray-400 text-center">
            {t(locale, 'photosRequired')}
          </p>
        )}

        <button
          onClick={() => onPhotosUploaded(urls)}
          disabled={urls.length === 0 || busy}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-lg font-bold rounded-2xl px-6 py-4 transition"
        >
          {busy ? '...' : t(locale, 'continue')}
        </button>
      </div>
    </div>
  );
}
