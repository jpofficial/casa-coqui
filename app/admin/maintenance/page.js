'use client';

import { useState, useMemo } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '@/hooks/useFirestore';
import { auth } from '@/lib/firebase';
import useLocale from '@/hooks/useLocale';
import useAuth from '@/hooks/useAuth';
import { t } from '@/lib/i18n';

// ---------------------------------------------------------------------------
// Brand palette status / urgency colors (from copa-best-ux-lead)
// ---------------------------------------------------------------------------
const STATUS_STYLES = {
  open:            'bg-flamboyan-50 text-flamboyan-700',
  acknowledged:    'bg-caribe-50 text-caribe-700',
  'in-progress':   'bg-atardecer-50 text-atardecer-700',
  done:            'bg-coqui-100 text-coqui-700',
  completed:       'bg-coqui-100 text-coqui-700',
  archived:        'bg-cafe-100 text-cafe-600',
  deleted:         'bg-cafe-100 text-cafe-400',
};

const URGENCY_BORDER = {
  high:   'border-l-flamboyan-500',
  High:   'border-l-flamboyan-500',
  medium: 'border-l-atardecer-400',
  Medium: 'border-l-atardecer-400',
  low:    'border-l-coqui-400',
  Low:    'border-l-coqui-400',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getStatusLabel(locale, status) {
  const keyMap = {
    open: 'admin_maint_statusOpen',
    acknowledged: 'admin_maint_statusAck',
    'in-progress': 'admin_maint_statusInProgress',
    done: 'admin_maint_statusDone',
    completed: 'admin_maint_statusDone',
    archived: 'admin_maint_statusArchived',
  };
  const key = keyMap[status];
  return key ? t(locale, key) : status;
}

function getCategoryLabel(locale, category) {
  const keyMap = {
    Plumbing: 'admin_maint_catPlumbing',
    Electrical: 'admin_maint_catElectrical',
    HVAC: 'admin_maint_catHVAC',
    Appliance: 'admin_maint_catAppliance',
    Other: 'admin_maint_catOther',
    lighting: 'admin_maint_catLighting',
    water: 'admin_maint_catWater',
    ac_heating: 'admin_maint_catAcHeating',
    appliance: 'admin_maint_catAppliance',
    lock_door: 'admin_maint_catLockDoor',
    wifi_tv: 'admin_maint_catWifiTv',
    pest: 'admin_maint_catPest',
    cleaning: 'admin_maint_catCleaning',
    noise: 'admin_maint_catNoise',
    other: 'admin_maint_catOther',
  };
  const key = keyMap[category];
  return key ? t(locale, key) : category;
}

function getUrgencyLabel(locale, urgency) {
  const keyMap = {
    Low: 'admin_maint_urgLow', low: 'admin_maint_urgLow',
    Medium: 'admin_maint_urgMedium', medium: 'admin_maint_urgMedium',
    High: 'admin_maint_urgHigh', high: 'admin_maint_urgHigh',
  };
  const key = keyMap[urgency];
  return key ? t(locale, key) : urgency;
}

function timeAgo(locale, dateValue) {
  if (!dateValue) return '';
  const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t(locale, 'admin_justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t(locale, 'admin_mAgo').replace('{n}', minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(locale, 'admin_hAgo').replace('{n}', hours);
  const days = Math.floor(hours / 24);
  return t(locale, 'admin_dAgo').replace('{n}', days);
}

async function patchMaintenance(id, updates) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(`/api/maintenance/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(updates),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to update');
  }
  return data;
}

// Sort priority: high=0, medium=1, low=2
function urgencyRank(u) {
  const r = { high: 0, High: 0, medium: 1, Medium: 1, low: 2, Low: 2 };
  return r[u] ?? 1;
}

// ---------------------------------------------------------------------------
// MaintenanceListItem — compact card, tappable, ~80px tall
// ---------------------------------------------------------------------------
function MaintenanceListItem({ request, locale, onSelect }) {
  const status = request.status || 'open';
  const urgency = request.urgency || 'medium';
  const borderColor = URGENCY_BORDER[urgency] || 'border-l-cafe-300';

  return (
    <button
      onClick={() => onSelect(request)}
      className={`w-full text-left bg-white rounded-xl shadow-sm border-l-[3px] ${borderColor} px-3.5 py-3 active:bg-cafe-50 transition-colors`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-coqui-900 truncate flex-1 leading-snug">
          {request.description}
          {request.photoUrl && (
            <svg className="w-3.5 h-3.5 text-coqui-800/30 inline ml-1.5 -mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
          )}
        </p>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${STATUS_STYLES[status] || 'bg-cafe-100 text-cafe-500'}`}>
          {getStatusLabel(locale, status)}
        </span>
      </div>
      <div className="flex items-center gap-1 mt-1 text-xs text-coqui-800/40">
        {request.unit && <span>{t(locale, 'admin_unitPrefix')} {request.unit}</span>}
        {request.unit && <span>·</span>}
        <span>{timeAgo(locale, request.createdAt)}</span>
        {request.guestName && (
          <>
            <span>·</span>
            <span className="truncate">{request.guestName}</span>
          </>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDialog — reusable confirmation modal
// ---------------------------------------------------------------------------
function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel, destructive }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-coqui-900">{title}</h3>
        <p className="text-sm text-coqui-800/70">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-cafe-100 text-cafe-700 active:bg-cafe-200 transition-colors"
          >
            {t('en', 'admin_cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors ${
              destructive ? 'bg-flamboyan-500 active:bg-flamboyan-600' : 'bg-coqui-600 active:bg-coqui-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MaintenanceDetail — bottom sheet with full info + actions
// ---------------------------------------------------------------------------
function MaintenanceDetail({ request, locale, isAdmin, onClose }) {
  const [changingStatus, setChangingStatus] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(request.notes || '');
  const [saving, setSaving] = useState(false);
  const [showRespond, setShowRespond] = useState(false);
  const [guestResponse, setGuestResponse] = useState(request.guestResponse || '');
  const [estimatedTime, setEstimatedTime] = useState(request.estimatedTime || '');
  const [sendingResponse, setSendingResponse] = useState(false);
  const [showAckFlow, setShowAckFlow] = useState(false);
  const [ackEta, setAckEta] = useState('');
  const [ackNote, setAckNote] = useState('');
  const [customEta, setCustomEta] = useState('');
  const [acknowledging, setAcknowledging] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'archive' | 'delete' | null

  const status = request.status || 'open';
  const urgency = request.urgency || 'medium';
  const category = request.category || 'Other';

  const ETA_PRESETS = [
    { label: t(locale, 'admin_maint_etaWithin1h'), value: 'Within 1 hour' },
    { label: t(locale, 'admin_maint_etaToday'), value: 'Today' },
    { label: t(locale, 'admin_maint_etaTomorrow'), value: 'Tomorrow' },
  ];

  async function handleStatusChange(newStatus) {
    if (changingStatus) return;
    setChangingStatus(true);
    try {
      await patchMaintenance(request.id, { status: newStatus });
      onClose();
    } catch (err) {
      console.error('Failed to update status:', err);
    } finally {
      setChangingStatus(false);
    }
  }

  async function handleAcknowledge() {
    setAcknowledging(true);
    try {
      const resolvedEta = ackEta === 'custom' ? customEta.trim() : ackEta;
      const updates = { status: 'acknowledged' };
      if (resolvedEta) updates.estimatedTime = resolvedEta;
      if (ackNote.trim()) updates.notes = ackNote.trim();
      await patchMaintenance(request.id, updates);
      setShowAckFlow(false);
      onClose();
    } catch (err) {
      console.error('Failed to acknowledge:', err);
    } finally {
      setAcknowledging(false);
    }
  }

  async function handleSaveNotes() {
    setSaving(true);
    try {
      await patchMaintenance(request.id, { notes: notes.trim() });
      setShowNotes(false);
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendResponse() {
    if (!guestResponse.trim() && !estimatedTime.trim()) return;
    setSendingResponse(true);
    try {
      const updates = {};
      if (guestResponse.trim()) updates.guestResponse = guestResponse.trim();
      if (estimatedTime.trim()) updates.estimatedTime = estimatedTime.trim();
      await patchMaintenance(request.id, updates);
      setShowRespond(false);
    } catch (err) {
      console.error('Failed to send response:', err);
    } finally {
      setSendingResponse(false);
    }
  }

  async function handleConfirmAction() {
    if (!confirmAction) return;
    await handleStatusChange(confirmAction === 'archive' ? 'archived' : 'deleted');
    setConfirmAction(null);
  }

  // Build activity timeline
  const timeline = [];
  timeline.push({ label: t(locale, 'admin_maint_submitted'), time: request.createdAt, who: request.guestName });
  if (request.acknowledgedAt) {
    const ackLine = request.estimatedTime
      ? `${t(locale, 'admin_maint_acked')} — ETA: ${request.estimatedTime}`
      : t(locale, 'admin_maint_acked');
    timeline.push({ label: ackLine, time: request.acknowledgedAt });
  }
  if (request.respondedAt && request.guestResponse) {
    timeline.push({ label: `"${request.guestResponse}"`, time: request.respondedAt });
  }
  if (request.completedAt || (status === 'done' && request.updatedAt)) {
    timeline.push({ label: t(locale, 'admin_maint_statusDone'), time: request.completedAt || request.updatedAt });
  }

  // Determine primary action
  let primaryAction = null;
  if (status === 'open') {
    primaryAction = { label: t(locale, 'admin_maint_ackAndRespond'), action: () => setShowAckFlow(true), style: 'bg-coqui-600 text-white active:bg-coqui-700' };
  } else if (status === 'acknowledged') {
    primaryAction = { label: t(locale, 'admin_maint_markInProgress'), action: () => handleStatusChange('in-progress'), style: 'bg-atardecer-500 text-white active:bg-atardecer-600' };
  } else if (status === 'in-progress') {
    primaryAction = { label: t(locale, 'admin_maint_markDone'), action: () => handleStatusChange('done'), style: 'bg-coqui-600 text-white active:bg-coqui-700' };
  } else if (status === 'done' || status === 'completed') {
    primaryAction = { label: t(locale, 'admin_maint_archive'), action: () => setConfirmAction('archive'), style: 'bg-cafe-200 text-cafe-800 active:bg-cafe-300' };
  }

  const isCompleted = status === 'done' || status === 'completed';
  const canReopen = status === 'acknowledged' || status === 'in-progress' || isCompleted;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-xl max-h-[85vh] overflow-y-auto safe-area-pb">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-cafe-200" />
        </div>

        <div className="px-5 pb-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[status] || 'bg-cafe-100 text-cafe-500'}`}>
                  {getStatusLabel(locale, status)}
                </span>
                <span className="text-xs text-coqui-800/50 font-medium">
                  {getCategoryLabel(locale, category)} · {getUrgencyLabel(locale, urgency)}
                </span>
              </div>
              {request.unit && (
                <p className="text-xs text-coqui-800/40">{t(locale, 'admin_unitPrefix')} {request.unit}</p>
              )}
            </div>
            <button onClick={onClose} className="p-1 -mr-1 text-coqui-800/40 hover:text-coqui-800">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Description */}
          <p className="text-sm text-coqui-900 leading-relaxed">{request.description}</p>

          {/* Photo */}
          {request.photoUrl && (
            <div>
              <button onClick={() => setViewPhoto(true)} className="block">
                <img
                  src={request.photoUrl}
                  alt={t(locale, 'admin_maint_photoAlt')}
                  className="w-full max-h-48 object-cover rounded-xl border border-cafe-200"
                />
              </button>
              {viewPhoto && (
                <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => setViewPhoto(false)}>
                  <button onClick={() => setViewPhoto(false)} className="absolute top-4 right-4 text-white/70 hover:text-white">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <img src={request.photoUrl} alt={t(locale, 'admin_maint_photoFull')} className="max-w-full max-h-full rounded-xl" />
                </div>
              )}
            </div>
          )}

          {/* Activity timeline */}
          {timeline.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-coqui-800/60 uppercase tracking-wide">{t(locale, 'admin_maint_activity')}</p>
              <div className="relative pl-4 space-y-2 border-l-2 border-cafe-200">
                {timeline.map((entry, i) => (
                  <div key={i} className="relative">
                    <div className="absolute -left-[calc(0.5rem+1px)] top-1.5 w-2 h-2 rounded-full bg-cafe-300" />
                    <p className="text-xs text-coqui-800/70">{entry.label}</p>
                    <p className="text-[10px] text-coqui-800/30">
                      {timeAgo(locale, entry.time)}
                      {entry.who && ` — ${entry.who}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Admin notes */}
          {!showNotes && request.notes && (
            <div className="bg-cafe-50 rounded-xl px-3.5 py-2.5 text-xs text-cafe-700">
              <span className="font-semibold">{t(locale, 'admin_maint_note')} </span>
              {request.notes}
            </div>
          )}

          {/* Notes editor */}
          {showNotes && (
            <div className="space-y-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t(locale, 'admin_maint_notePlaceholder')}
                rows={3}
                className="w-full rounded-xl border border-cafe-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-coqui-500 focus:border-transparent resize-none"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveNotes} disabled={saving} className="flex-1 bg-coqui-600 text-white rounded-xl py-2.5 text-xs font-semibold disabled:opacity-50">
                  {saving ? t(locale, 'admin_saving') : t(locale, 'admin_maint_saveNote')}
                </button>
                <button onClick={() => { setNotes(request.notes || ''); setShowNotes(false); }} className="flex-1 bg-cafe-100 text-cafe-600 rounded-xl py-2.5 text-xs font-semibold">
                  {t(locale, 'admin_cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Acknowledge flow */}
          {showAckFlow && (
            <div className="space-y-2 bg-caribe-50 rounded-xl p-3.5">
              <p className="text-xs font-semibold text-caribe-800">{t(locale, 'admin_maint_ackTitle')}</p>
              <div className="flex flex-wrap gap-1.5">
                {ETA_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => { setAckEta(preset.value); setCustomEta(''); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      ackEta === preset.value ? 'bg-caribe-600 text-white' : 'bg-white text-caribe-700 border border-caribe-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  onClick={() => setAckEta('custom')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    ackEta === 'custom' ? 'bg-caribe-600 text-white' : 'bg-white text-caribe-700 border border-caribe-200'
                  }`}
                >
                  {t(locale, 'admin_maint_etaCustom')}
                </button>
              </div>
              {ackEta === 'custom' && (
                <input
                  type="text"
                  value={customEta}
                  onChange={(e) => setCustomEta(e.target.value)}
                  placeholder={t(locale, 'admin_maint_etaCustomPlaceholder')}
                  className="w-full rounded-xl border border-caribe-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-caribe-500 focus:border-transparent"
                />
              )}
              <textarea
                value={ackNote}
                onChange={(e) => setAckNote(e.target.value)}
                placeholder={t(locale, 'admin_maint_ackNotePlaceholder')}
                rows={2}
                className="w-full rounded-xl border border-caribe-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-caribe-500 focus:border-transparent resize-none"
              />
              <div className="flex gap-2">
                <button onClick={handleAcknowledge} disabled={acknowledging} className="flex-1 bg-caribe-600 text-white rounded-xl py-2.5 text-xs font-semibold disabled:opacity-50">
                  {acknowledging ? t(locale, 'admin_maint_acknowledging') : t(locale, 'admin_maint_acknowledge')}
                </button>
                <button onClick={() => { setShowAckFlow(false); setAckEta(''); setAckNote(''); setCustomEta(''); }} className="flex-1 bg-white text-cafe-600 border border-cafe-200 rounded-xl py-2.5 text-xs font-semibold">
                  {t(locale, 'admin_cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Respond to guest */}
          {showRespond && (
            <div className="space-y-2 bg-caribe-50 rounded-xl p-3.5">
              <p className="text-xs font-semibold text-caribe-800">{t(locale, 'admin_maint_respondTitle')}</p>
              <textarea
                value={guestResponse}
                onChange={(e) => setGuestResponse(e.target.value)}
                placeholder={t(locale, 'admin_maint_respondPlaceholder')}
                rows={3}
                className="w-full rounded-xl border border-caribe-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-caribe-500 focus:border-transparent resize-none"
              />
              <input
                type="text"
                value={estimatedTime}
                onChange={(e) => setEstimatedTime(e.target.value)}
                placeholder={t(locale, 'admin_maint_etaPlaceholder')}
                className="w-full rounded-xl border border-caribe-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-caribe-500 focus:border-transparent"
              />
              <div className="flex gap-2">
                <button onClick={handleSendResponse} disabled={sendingResponse || (!guestResponse.trim() && !estimatedTime.trim())} className="flex-1 bg-caribe-600 text-white rounded-xl py-2.5 text-xs font-semibold disabled:opacity-50">
                  {sendingResponse ? t(locale, 'admin_maint_sending') : t(locale, 'admin_maint_sendToGuest')}
                </button>
                <button onClick={() => { setGuestResponse(request.guestResponse || ''); setEstimatedTime(request.estimatedTime || ''); setShowRespond(false); }} className="flex-1 bg-white text-cafe-600 border border-cafe-200 rounded-xl py-2.5 text-xs font-semibold">
                  {t(locale, 'admin_cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Primary action */}
          {primaryAction && !showAckFlow && !showRespond && (
            <button
              onClick={primaryAction.action}
              disabled={changingStatus}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${primaryAction.style}`}
            >
              {changingStatus ? t(locale, 'admin_updating') : primaryAction.label}
            </button>
          )}

          {/* Secondary links */}
          {!showAckFlow && !showRespond && (
            <div className="flex flex-wrap gap-3 justify-center text-xs font-medium">
              {!showNotes && (
                <button onClick={() => setShowNotes(true)} className="text-coqui-600">
                  {request.notes ? t(locale, 'admin_maint_editNote') : t(locale, 'admin_maint_addNote')}
                </button>
              )}
              {status !== 'open' && (
                <button onClick={() => setShowRespond(true)} className="text-caribe-600">
                  {request.guestResponse ? t(locale, 'admin_maint_editResponse') : t(locale, 'admin_maint_respondToGuest')}
                </button>
              )}
              {canReopen && (
                <button onClick={() => handleStatusChange('open')} disabled={changingStatus} className="text-coqui-800/40">
                  {t(locale, 'admin_maint_reopen')}
                </button>
              )}
              {status === 'archived' && (
                <button onClick={() => handleStatusChange('open')} disabled={changingStatus} className="text-coqui-600">
                  {t(locale, 'admin_maint_restore')}
                </button>
              )}
            </div>
          )}

          {/* Admin-only destructive actions */}
          {isAdmin && !showAckFlow && !showRespond && (
            <div className="flex justify-center gap-4 pt-2 border-t border-cafe-100">
              {!isCompleted && status !== 'archived' && (
                <button onClick={() => setConfirmAction('delete')} className="text-xs text-flamboyan-400 font-medium">
                  {t(locale, 'admin_maint_delete')}
                </button>
              )}
              {isCompleted && (
                <button onClick={() => setConfirmAction('delete')} className="text-xs text-flamboyan-400 font-medium">
                  {t(locale, 'admin_maint_delete')}
                </button>
              )}
              {status === 'archived' && (
                <button onClick={() => setConfirmAction('delete')} className="text-xs text-flamboyan-400 font-medium">
                  {t(locale, 'admin_maint_delete')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction === 'archive' ? t(locale, 'admin_maint_archiveConfirmTitle') : t(locale, 'admin_maint_deleteConfirmTitle')}
        message={confirmAction === 'archive' ? t(locale, 'admin_maint_archiveConfirmMsg') : t(locale, 'admin_maint_deleteConfirmMsg')}
        confirmLabel={confirmAction === 'archive' ? t(locale, 'admin_maint_archive') : t(locale, 'admin_maint_delete')}
        destructive={confirmAction === 'delete'}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Section header with dot accent
// ---------------------------------------------------------------------------
function SectionHeader({ label, count, dotColor }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1.5 sticky top-0 bg-cafe-50/95 backdrop-blur-sm z-10">
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span className="text-sm font-semibold text-coqui-800">{label}</span>
      {count > 0 && (
        <span className="text-[10px] font-bold text-coqui-800/40">{count}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MaintenancePage — grouped sections, no filter tabs
// ---------------------------------------------------------------------------
export default function MaintenancePage() {
  const { locale } = useLocale();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [selected, setSelected] = useState(null);
  const [viewMode, setViewMode] = useState('active'); // 'active' | 'archived'

  const { data: requests, loading } = useCollection('maintenance', [
    orderBy('createdAt', 'desc'),
  ]);

  // Filter out deleted, partition into groups
  const { needsAttention, inProgress, recentlyCompleted, archived } = useMemo(() => {
    const active = requests.filter((r) => r.status !== 'deleted' && r.status !== 'archived');
    const archivedItems = requests.filter((r) => r.status === 'archived');

    const na = active
      .filter((r) => r.status === 'open' || r.status === 'acknowledged')
      .sort((a, b) => {
        const ud = urgencyRank(a.urgency) - urgencyRank(b.urgency);
        if (ud !== 0) return ud;
        // Oldest first within same urgency
        const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
        const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
        return aDate - bDate;
      });

    const ip = active
      .filter((r) => r.status === 'in-progress')
      .sort((a, b) => {
        const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
        const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
        return aDate - bDate;
      });

    // Done items from last 7 days, max 5
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const rc = active
      .filter((r) => {
        if (r.status !== 'done' && r.status !== 'completed') return false;
        const d = r.completedAt || r.updatedAt;
        const date = d?.toDate ? d.toDate() : new Date(d);
        return date.getTime() > sevenDaysAgo;
      })
      .slice(0, 5);

    return { needsAttention: na, inProgress: ip, recentlyCompleted: rc, archived: archivedItems };
  }, [requests]);

  const openCount = needsAttention.length;
  const ipCount = inProgress.length;
  const totalActive = openCount + ipCount;

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-bold text-coqui-900">{t(locale, 'admin_maint_title')}</h1>
          {openCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-flamboyan-50 text-flamboyan-700">
              {openCount} {t(locale, 'admin_maint_openLabel')}
            </span>
          )}
        </div>
        {/* Toggle: Active / Archived */}
        <div className="flex bg-cafe-100 rounded-lg p-0.5 text-xs font-semibold">
          <button
            onClick={() => setViewMode('active')}
            className={`px-3 py-1 rounded-md transition-colors ${viewMode === 'active' ? 'bg-white text-coqui-800 shadow-sm' : 'text-coqui-800/40'}`}
          >
            {t(locale, 'admin_maint_activeTab')}
          </button>
          <button
            onClick={() => setViewMode('archived')}
            className={`px-3 py-1 rounded-md transition-colors ${viewMode === 'archived' ? 'bg-white text-coqui-800 shadow-sm' : 'text-coqui-800/40'}`}
          >
            {t(locale, 'admin_maint_archivedTab')}
            {archived.length > 0 && (
              <span className="ml-1 text-[10px] text-coqui-800/30">{archived.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {viewMode === 'active' && !loading && totalActive > 0 && (
        <p className="text-xs text-coqui-800/40">
          {openCount > 0 && `${openCount} ${t(locale, 'admin_maint_needAttention')}`}
          {openCount > 0 && ipCount > 0 && ' · '}
          {ipCount > 0 && `${ipCount} ${t(locale, 'admin_maint_inProgressLabel')}`}
          {recentlyCompleted.length > 0 && ` · ${recentlyCompleted.length} ${t(locale, 'admin_maint_completedThisWeek')}`}
        </p>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3 pt-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-admin-shimmer">
              <div className="h-4 bg-cafe-100 rounded w-3/4 mb-2" />
              <div className="h-3 bg-cafe-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Active view */}
      {!loading && viewMode === 'active' && (
        <>
          {/* Needs Attention */}
          {needsAttention.length > 0 && (
            <div>
              <SectionHeader label={t(locale, 'admin_maint_sectionNeedsAttention')} count={needsAttention.length} dotColor="bg-flamboyan-400" />
              <div className="space-y-2">
                {needsAttention.map((r) => (
                  <MaintenanceListItem key={r.id} request={r} locale={locale} onSelect={setSelected} />
                ))}
              </div>
            </div>
          )}

          {/* In Progress */}
          {inProgress.length > 0 && (
            <div>
              <SectionHeader label={t(locale, 'admin_maint_sectionInProgress')} count={inProgress.length} dotColor="bg-atardecer-400" />
              <div className="space-y-2">
                {inProgress.map((r) => (
                  <MaintenanceListItem key={r.id} request={r} locale={locale} onSelect={setSelected} />
                ))}
              </div>
            </div>
          )}

          {/* Recently Completed */}
          {recentlyCompleted.length > 0 && (
            <div>
              <SectionHeader label={t(locale, 'admin_maint_sectionRecentlyDone')} count={recentlyCompleted.length} dotColor="bg-coqui-400" />
              <div className="space-y-2 opacity-70">
                {recentlyCompleted.map((r) => (
                  <MaintenanceListItem key={r.id} request={r} locale={locale} onSelect={setSelected} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {needsAttention.length === 0 && inProgress.length === 0 && recentlyCompleted.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <svg className="w-12 h-12 text-coqui-300 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.26 3.105 1.005-5.855-4.26-4.15 5.88-.855L11.42 2.06l2.625 5.355 5.88.855-4.26 4.15 1.005 5.855-5.25-3.105z" />
              </svg>
              <p className="text-base font-semibold text-coqui-800">{t(locale, 'admin_maint_allClear')}</p>
              <p className="text-sm text-coqui-800/50 mt-1">{t(locale, 'admin_maint_allClearSub')}</p>
            </div>
          )}
        </>
      )}

      {/* Archived view */}
      {!loading && viewMode === 'archived' && (
        <>
          {archived.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <p className="text-sm text-coqui-800/40">{t(locale, 'admin_maint_noArchived')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {archived.map((r) => (
                <MaintenanceListItem key={r.id} request={r} locale={locale} onSelect={setSelected} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Detail bottom sheet */}
      {selected && (
        <MaintenanceDetail
          key={selected.id}
          request={selected}
          locale={locale}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
