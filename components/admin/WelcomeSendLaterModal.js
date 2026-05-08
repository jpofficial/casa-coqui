'use client';

import { useState } from 'react';
import { t } from '@/lib/i18n';
import { computeDefaultSnoozeIso } from '@/lib/welcome-status';

export default function WelcomeSendLaterModal({ checkInDate, locale = 'en', onConfirm, onCancel }) {
  const presets = [
    {
      id: 'tomorrow',
      labelKey: 'admin_book_sendLater_tomorrow',
      iso: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
      },
    },
    {
      id: 'dayBefore',
      labelKey: 'admin_book_sendLater_dayBefore',
      iso: () => computeDefaultSnoozeIso(checkInDate),
    },
    {
      id: 'morningOf',
      labelKey: 'admin_book_sendLater_morningOf',
      iso: () => {
        if (!checkInDate) return null;
        const parts = String(checkInDate).split('-').map(Number);
        if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
        const [y, m, d] = parts;
        return new Date(y, m - 1, d, 9, 0, 0, 0).toISOString();
      },
    },
    { id: 'custom', labelKey: 'admin_book_sendLater_custom', iso: null },
  ];

  const defaultPresetId = checkInDate ? 'dayBefore' : 'tomorrow';
  const [selected, setSelected] = useState(defaultPresetId);
  const [customDt, setCustomDt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function currentIso() {
    if (selected === 'custom') {
      if (!customDt) return null;
      const d = new Date(customDt);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const preset = presets.find((p) => p.id === selected);
    return preset?.iso ? preset.iso() : null;
  }

  async function handleConfirm() {
    const iso = currentIso();
    if (!iso) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm(iso);
    } catch (err) {
      setError(err?.message || 'Failed to snooze.');
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
        aria-labelledby="send-later-dialog-title"
        className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="send-later-dialog-title" className="text-lg font-semibold text-gray-900 mb-3">
          {t(locale, 'admin_book_sendLater_title')}
        </h3>
        <div className="space-y-2">
          {presets.map((p) => {
            const disabled =
              p.id !== 'custom' && p.id !== 'tomorrow' && !checkInDate;
            return (
              <label
                key={p.id}
                className={`flex items-center gap-2 p-2 border rounded-lg text-sm cursor-pointer ${
                  selected === p.id ? 'border-coqui-600 bg-coqui-50' : 'border-gray-200'
                } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <input
                  type="radio"
                  name="snooze-preset"
                  value={p.id}
                  checked={selected === p.id}
                  onChange={() => setSelected(p.id)}
                  disabled={disabled}
                />
                {t(locale, p.labelKey)}
              </label>
            );
          })}
          {selected === 'custom' && (
            <input
              type="datetime-local"
              value={customDt}
              onChange={(e) => setCustomDt(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg text-sm"
            />
          )}
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            {t(locale, 'admin_book_markSent_cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !currentIso()}
            className="px-4 py-2 text-sm bg-coqui-600 text-white rounded-lg font-semibold hover:bg-coqui-700 disabled:opacity-50"
          >
            {saving ? '…' : t(locale, 'admin_book_sendLater_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
