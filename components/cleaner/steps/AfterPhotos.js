'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import ImageUpload from '@/components/ui/ImageUpload';

export default function AfterPhotos({ job, locale, onPhotosUploaded, busy }) {
  const [urls, setUrls] = useState([]);

  function handlePhotosAdded(newUrls) {
    // newUrls is an array when multiple=true
    setUrls((prev) => [...prev, ...newUrls].slice(0, 10));
  }

  function handleRemovePhoto(index) {
    setUrls((prev) => prev.filter((_, i) => i !== index));
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
              <div key={i} className="relative">
                <img
                  src={url}
                  alt={`After ${i + 1}`}
                  className="w-full h-32 object-cover rounded-xl border border-gray-200"
                />
                <button
                  type="button"
                  onClick={() => handleRemovePhoto(i)}
                  className="absolute top-1 right-1 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow hover:bg-red-700"
                  aria-label="Remove photo"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        {urls.length < 10 && (
          <ImageUpload
            storagePath={`cleaning_jobs/${job.id}/after`}
            value=""
            onChange={handlePhotosAdded}
            label={t(locale, 'addPhotos')}
            multiple
            noCapture
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
          className="w-full bg-coqui-600 hover:bg-coqui-700 disabled:bg-cafe-300 text-white text-lg font-bold rounded-2xl px-6 py-4 transition"
        >
          {busy ? t(locale, 'sending') : t(locale, 'continue')}
        </button>
      </div>
    </div>
  );
}
