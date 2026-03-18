'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import ImageUpload from '@/components/ui/ImageUpload';

const CATEGORIES = ['damage', 'missingItem', 'repairNeeded', 'other'];
const CATEGORY_VALUES = { damage: 'damage', missingItem: 'missing', repairNeeded: 'repair', other: 'other' };

export default function IssueReport({ job, locale, onSubmit, onCancel, busy }) {
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  function handleSubmit() {
    if (!category) return;
    onSubmit({
      category: CATEGORY_VALUES[category],
      description,
      photoUrl: photoUrl || null,
    });
  }

  return (
    <div className="flex flex-col items-center min-h-[60vh] px-6">
      <h2 className="text-lg font-bold text-gray-900 mt-4 mb-6">
        {t(locale, 'reportIssue')}
      </h2>

      <div className="w-full max-w-sm space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`rounded-xl border-2 px-4 py-3 text-sm font-semibold transition ${
                category === cat
                  ? 'border-atardecer-500 bg-atardecer-50 text-atardecer-700'
                  : 'border-cafe-200 bg-white text-coqui-800'
              }`}
            >
              {t(locale, cat)}
            </button>
          ))}
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t(locale, 'describeIssue')}
          rows={3}
          className="w-full rounded-xl border border-cafe-200 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-atardecer-500"
        />

        <ImageUpload
          storagePath={`cleaning_jobs/${job.id}/issues`}
          value={photoUrl}
          onChange={setPhotoUrl}
          label={t(locale, 'takePhoto')}
        />

        <button
          onClick={handleSubmit}
          disabled={!category || busy}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white text-lg font-bold rounded-2xl px-6 py-4 transition"
        >
          {busy ? t(locale, 'sending') : t(locale, 'sendReport')}
        </button>

        <button
          onClick={onCancel}
          className="w-full text-gray-500 text-sm font-medium py-2"
        >
          {t(locale, 'cancel')}
        </button>
      </div>
    </div>
  );
}
