'use client';

import { t } from '@/lib/i18n';

/**
 * Renders a single colored pill reflecting a booking's welcome or lifecycle
 * state. Accepts one of: ready, generating, snoozed, sent, skipped, error,
 * cancelled, in_house, past, unmatched.
 */
export default function StatusPill({ status, locale = 'en' }) {
  const styleMap = {
    ready:      'bg-amber-100 text-amber-800',
    generating: 'bg-indigo-100 text-indigo-800',
    snoozed:    'bg-purple-100 text-purple-800',
    sent:       'bg-emerald-100 text-emerald-800',
    skipped:    'bg-gray-200 text-gray-600',
    error:      'bg-red-100 text-red-700',
    cancelled:  'bg-red-100 text-red-700',
    in_house:   'bg-blue-100 text-blue-800',
    past:       'bg-gray-100 text-gray-600',
    unmatched:  'bg-amber-50 text-amber-700 border border-amber-200',
  };

  const labelKeyMap = {
    ready:      'admin_book_pill_ready',
    generating: 'admin_book_pill_generating',
    snoozed:    'admin_book_pill_snoozed',
    sent:       'admin_book_pill_sent',
    skipped:    'admin_book_pill_skipped',
    error:      'admin_book_pill_error',
    cancelled:  'admin_book_pill_cancelled',
    in_house:   'admin_book_pill_inhouse',
    past:       'admin_book_pill_past',
    unmatched:  'admin_msg_unmatched_badge',
  };

  const cls = styleMap[status] || 'bg-gray-100 text-gray-600';
  const label = t(locale, labelKeyMap[status] || 'admin_book_pill_past');

  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-semibold ${cls}`}>
      {label}
    </span>
  );
}
