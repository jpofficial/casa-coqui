'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';

export default function WelcomeMarkSentModal({ initialText, locale = 'en', onConfirm, onCancel }) {
  const [text, setText] = useState(initialText || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!text.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm(text.trim());
    } catch (err) {
      setError(err?.message || 'Failed to mark as sent.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4"
      onClick={() => { if (!saving) onCancel(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !saving) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mark-sent-dialog-title"
        className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="mark-sent-dialog-title" className="text-lg font-semibold text-gray-900 mb-1">
          {t(locale, 'admin_book_markSent_title')}
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          {t(locale, 'admin_book_markSent_hint')}
        </p>
        <textarea
          className="w-full h-48 p-3 border border-gray-300 rounded-lg text-sm font-mono text-gray-900 focus:outline-none focus:ring-2 focus:ring-coqui-500"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        {error && (
          <p className="text-xs text-red-600 mt-2">{error}</p>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg disabled:opacity-50"
          >
            {t(locale, 'admin_book_markSent_cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !text.trim()}
            className="px-4 py-2 text-sm bg-coqui-600 text-white rounded-lg font-semibold hover:bg-coqui-700 disabled:opacity-50"
          >
            {saving ? '…' : t(locale, 'admin_book_markSent_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
