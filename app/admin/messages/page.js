'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import { buildThreadKey, isUnmatchedKey } from '@/lib/thread-key';
import { extractGuestMessage } from '@/lib/extract-guest-message';
import LinkToBookingModal from '@/components/admin/LinkToBookingModal';
import RefineDrawer from '@/components/admin/RefineDrawer';

function timeAgo(dateValue, locale) {
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

function formatTime(dateValue, locale) {
  if (!dateValue) return '';
  const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  return date.toLocaleTimeString(locale === 'es' ? 'es' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateDivider(dateValue, locale) {
  if (!dateValue) return '';
  const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t(locale, 'admin_msg_today');
  if (date.toDateString() === yesterday.toDateString()) return t(locale, 'admin_msg_yesterday');
  return date.toLocaleDateString(locale === 'es' ? 'es' : 'en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(dateValue, locale) {
  if (!dateValue) return '';
  const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  return date.toLocaleDateString(locale === 'es' ? 'es' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Returns a label string for draft welcome messages, or null for normal sent messages.
function welcomeStateLabel(msg, locale) {
  if (!msg.welcomeState || msg.welcomeState === 'sent') return null;
  if (msg.welcomeState === 'snoozed') {
    const when = msg.welcomeSnoozedUntil
      ? new Date(msg.welcomeSnoozedUntil).toLocaleDateString(
          locale === 'es' ? 'es' : 'en-US',
          { month: 'short', day: 'numeric' }
        )
      : '';
    return t(locale, 'admin_msg_draft_snoozed').replace('{when}', when);
  }
  if (msg.welcomeState === 'skipped') {
    return t(locale, 'admin_msg_draft_skipped');
  }
  return null;
}

// Build a thread list from a flat array of messages.
// Groups by threadKey so unmatched senders get their own threads instead of
// all being lumped into one 'unknown' bucket.
function buildThreads(messages) {
  const threadMap = {};
  for (const msg of messages) {
    const key =
      msg.threadKey ||
      buildThreadKey({
        bookingCode: msg.bookingCode || null,
        senderEmail: msg.senderEmail || msg.fromAddress || null,
        senderName: msg.guestName || msg.fromName || null,
        receivedAt: msg.receivedAt?.toDate?.() || msg.createdAt?.toDate?.() || null,
      });

    if (!threadMap[key]) {
      threadMap[key] = {
        threadKey: key,
        bookingCode: isUnmatchedKey(key) ? null : key,
        guestName: msg.guestName || msg.fromName || key,
        messages: [],
        lastMessage: null,
        unreadCount: 0,
        unmatched: isUnmatchedKey(key),
      };
    }
    threadMap[key].messages.push(msg);
    if (
      !threadMap[key].lastMessage ||
      compareFirestoreDates(msg.createdAt, threadMap[key].lastMessage.createdAt) > 0
    ) {
      threadMap[key].lastMessage = msg;
    }
    if (msg.sender === 'guest' && !msg.read) {
      threadMap[key].unreadCount += 1;
    }
  }
  // Sort threads by last message descending
  return Object.values(threadMap).sort((a, b) =>
    compareFirestoreDates(b.lastMessage?.createdAt, a.lastMessage?.createdAt)
  );
}

function compareFirestoreDates(a, b) {
  const toMs = (v) => {
    if (!v) return 0;
    if (v?.toDate) return v.toDate().getTime();
    return new Date(v).getTime();
  };
  return toMs(a) - toMs(b);
}

// Group thread messages by calendar day
function groupByDay(messages, locale) {
  const groups = [];
  let currentDay = null;
  for (const msg of messages) {
    const dayLabel = formatDateDivider(msg.createdAt, locale);
    if (dayLabel !== currentDay) {
      currentDay = dayLabel;
      groups.push({ type: 'divider', label: dayLabel, key: `divider-${dayLabel}-${msg.id}` });
    }
    groups.push({ type: 'message', msg, key: msg.id });
  }
  return groups;
}

// Thread list item
function ThreadItem({ thread, onSelect }) {
  const { locale } = useLocale();
  const last = thread.lastMessage;
  return (
    <button
      onClick={() => onSelect(thread)}
      className="w-full bg-white rounded-xl shadow-sm p-4 text-left flex items-start gap-3 active:bg-gray-50 transition-colors"
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 text-green-700 font-bold text-sm uppercase">
        {(thread.guestName || thread.bookingCode || thread.threadKey || '?').charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-semibold text-gray-900 truncate">
            {thread.guestName !== thread.bookingCode
              ? thread.guestName
              : `${t(locale, 'admin_msg_guestPrefix')} ${thread.bookingCode}`}
          </span>
          {thread.unmatched && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full whitespace-nowrap">
              {t(locale, 'admin_msg_unmatched_badge')}
            </span>
          )}
          <span className="text-[11px] text-gray-400 flex-shrink-0">{timeAgo(last?.createdAt, locale)}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-xs text-gray-500 truncate flex-1">
            {last?.sender === 'host' ? t(locale, 'admin_msg_you') + ' ' : ''}
            {last?.text || ''}
          </p>
          {thread.unreadCount > 0 && (
            <span className="flex-shrink-0 bg-green-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {thread.unreadCount > 9 ? '9+' : thread.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// Full chat view for a single thread
function ChatView({ thread, allMessages, onBack, onLinkClick }) {
  const { locale } = useLocale();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  // Messages sorted oldest first — match by threadKey so unmatched threads work too
  const threadMessages = allMessages
    .filter((m) => {
      const key =
        m.threadKey ||
        buildThreadKey({
          bookingCode: m.bookingCode || null,
          senderEmail: m.senderEmail || m.fromAddress || null,
          senderName: m.guestName || m.fromName || null,
          receivedAt: m.receivedAt?.toDate?.() || m.createdAt?.toDate?.() || null,
        });
      return key === thread.threadKey;
    })
    .sort((a, b) => compareFirestoreDates(a.createdAt, b.createdAt));

  const grouped = groupByDay(threadMessages, locale);

  // Mark all unread guest messages as read when thread opens
  useEffect(() => {
    const unread = threadMessages.filter((m) => m.sender === 'guest' && !m.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach((m) => {
      batch.update(doc(db, 'messages', m.id), { read: true });
    });
    batch.commit().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.threadKey]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages.length]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    try {
      await addDoc(collection(db, 'messages'), {
        bookingCode: thread.bookingCode,
        guestName: thread.guestName,
        sender: 'host',
        text: trimmed,
        createdAt: serverTimestamp(),
        read: false,
      });

      // Notify guest of host reply (fire-and-forget)
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      if (idToken) {
        fetch('/api/messages/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            bookingCode: thread.bookingCode,
            sender: 'host',
          }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setText(trimmed);
    } finally {
      setSending(false);
    }
  }, [text, sending, thread.bookingCode, thread.guestName]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-112px)]">
      {/* Chat header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-green-600 min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2"
          aria-label={t(locale, 'admin_msg_back')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm uppercase flex-shrink-0">
          {(thread.guestName || thread.bookingCode || thread.threadKey || '?').charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {thread.guestName !== thread.bookingCode
                ? thread.guestName
                : `${t(locale, 'admin_msg_guestPrefix')} ${thread.bookingCode}`}
            </p>
            {thread.unmatched && onLinkClick && (
              <button
                onClick={onLinkClick}
                className="ml-2 text-[10px] px-2 py-1 bg-coqui-600 text-white rounded-lg font-semibold hover:bg-coqui-700 whitespace-nowrap flex-shrink-0"
              >
                {t(locale, 'admin_msg_link_button')}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 truncate">{t(locale, 'admin_msg_codePrefix')} {thread.bookingCode}</p>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-gray-50">
        {grouped.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">{t(locale, 'admin_msg_emptyChat')}</p>
        )}
        {grouped.map((item) => {
          if (item.type === 'divider') {
            return (
              <div key={item.key} className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-[11px] text-gray-400 font-medium">{item.label}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            );
          }
          const { msg } = item;
          const isHost = msg.sender === 'host';
          const isDraft = msg.direction === 'outbound_draft';
          const draftLabel = welcomeStateLabel(msg, locale);
          return (
            <div key={item.key} className={`flex ${isHost ? 'justify-end' : 'justify-start'} mt-1`}>
              <div
                className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl text-sm leading-snug shadow-sm ${
                  isDraft
                    ? 'bg-green-100 text-green-900 rounded-br-sm opacity-60'
                    : isHost
                    ? 'bg-green-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-800 rounded-bl-sm'
                }`}
              >
                <p>{msg.text}</p>
                <p className={`text-[10px] mt-1 ${isHost && !isDraft ? 'text-green-200' : 'text-gray-400'} text-right`}>
                  {formatTime(msg.createdAt, locale)}
                </p>
                {isDraft && draftLabel && (
                  <div className="mt-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full inline-block">
                    {draftLabel}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply input */}
      <div className="bg-white border-t border-gray-100 px-4 py-3 flex items-end gap-2 flex-shrink-0">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t(locale, 'admin_msg_placeholder')}
          rows={1}
          className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none max-h-32"
          style={{ minHeight: '44px' }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="bg-green-600 text-white rounded-xl p-3 flex-shrink-0 disabled:opacity-50 active:bg-green-700 transition-colors"
          aria-label={t(locale, 'admin_msg_send')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Airbnb Messages Tab
// ─────────────────────────────────────────────────────────────────────────────

const DRAFT_STATUS_CONFIG = {
  pending: { labelKey: 'admin_msg_draftPending', color: 'bg-yellow-100 text-yellow-700' },
  ready: { labelKey: 'admin_msg_draftReady', color: 'bg-green-100 text-green-700' },
  sent: { labelKey: 'admin_msg_draftSent', color: 'bg-gray-100 text-gray-500' },
  escalated: { labelKey: 'admin_msg_draftEscalated', color: 'bg-red-100 text-red-600' },
  error: { labelKey: 'admin_msg_draftError', color: 'bg-red-100 text-red-600' },
};

function DraftStatusBadge({ status, locale }) {
  const config = DRAFT_STATUS_CONFIG[status] || DRAFT_STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${config.color}`}>
      {t(locale, config.labelKey)}
    </span>
  );
}

function MarkSentModal({ message, onConfirm, onCancel, locale }) {
  const [editedReply, setEditedReply] = useState(message.draftReply || '');
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    setConfirming(true);
    await onConfirm(editedReply.trim() || message.draftReply || '');
    setConfirming(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0">
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 shadow-xl">
        <p className="text-sm font-semibold text-gray-900 mb-3">
          {t(locale, 'admin_msg_editBeforeSend')}
        </p>
        <textarea
          value={editedReply}
          onChange={(e) => setEditedReply(e.target.value)}
          rows={5}
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
        />
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={confirming}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 active:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {t(locale, 'admin_msg_cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium active:bg-green-700 transition-colors disabled:opacity-50"
          >
            {confirming ? t(locale, 'admin_saving') : t(locale, 'admin_msg_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AirbnbMessageCard({ message, locale }) {
  const [expanded, setExpanded] = useState(false);
  const [markSentOpen, setMarkSentOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);

  const isMatched = Boolean(message.bookingId);
  const hasActions = isMatched && (message.draftStatus === 'ready' || message.draftStatus === 'escalated');

  async function handleCopy() {
    if (!message.draftReply) return;
    try {
      await navigator.clipboard.writeText(message.draftReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }

  async function handleMarkSent(finalReply) {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'airbnb_messages', message.id), {
        draftStatus: 'sent',
        sentAt: serverTimestamp(),
        editedReply: finalReply,
      });
    } catch (err) {
      console.error('Failed to mark as sent:', err);
    } finally {
      setBusy(false);
      setMarkSentOpen(false);
    }
  }

  async function handleRegenerate() {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'airbnb_messages', message.id), {
        draftStatus: 'pending',
        draftReply: null,
        regeneratedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to trigger regenerate:', err);
    } finally {
      setBusy(false);
    }
  }

  async function handleEscalate() {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'airbnb_messages', message.id), {
        draftStatus: 'escalated',
        escalatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to escalate:', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {/* Card header */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left px-4 pt-4 pb-3 flex items-start gap-3"
        >
          {/* Avatar */}
          <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0 text-orange-600 font-bold text-sm uppercase">
            {(message.guestName || 'G').charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900 truncate">
                {message.guestName || 'Guest'}
              </span>
              {message.unitLabel && (
                <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                  {message.unitLabel}
                </span>
              )}
              {!isMatched && (
                <span className="text-[11px] font-medium bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full">
                  {t(locale, 'admin_msg_unmatched')}
                </span>
              )}
              <DraftStatusBadge status={message.draftStatus || 'pending'} locale={locale} />
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {formatFullDate(message.receivedAt, locale)}
            </p>
          </div>
          {/* Chevron */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Inbound message preview (always visible, 2-line clamp) */}
        <div className="px-4 pb-3">
          <p className={`text-sm text-gray-700 leading-snug ${expanded ? '' : 'line-clamp-2'}`}>
            {message.body
              ? extractGuestMessage(message.body)
              : (message.text || message.messageBody || '')}
          </p>
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="border-t border-gray-100">
            {/* Draft reply preview */}
            {message.draftReply && (
              <div className="mx-4 my-3 p-3 bg-green-50 rounded-xl border border-green-100">
                <p className="text-[11px] font-semibold text-green-700 mb-1 uppercase tracking-wide">
                  Draft Reply
                </p>
                <p className="text-sm text-gray-800 leading-snug whitespace-pre-wrap">
                  {message.draftReply}
                </p>
              </div>
            )}

            {/* Sent/edited reply */}
            {message.draftStatus === 'sent' && message.editedReply && message.editedReply !== message.draftReply && (
              <div className="mx-4 mb-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <p className="text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">
                  Sent Reply
                </p>
                <p className="text-sm text-gray-700 leading-snug whitespace-pre-wrap">
                  {message.editedReply}
                </p>
              </div>
            )}

            {/* Action buttons */}
            {hasActions && (
              <div className="px-4 pb-4 flex flex-wrap gap-2">
                {message.draftReply && (
                  <button
                    onClick={handleCopy}
                    disabled={busy}
                    className="flex-1 min-w-[120px] py-2 px-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 active:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    {copied ? t(locale, 'admin_book_copied') : t(locale, 'admin_msg_copyReply')}
                  </button>
                )}
                {message.draftStatus === 'ready' && message.draftReply && (
                  <button
                    onClick={() => setRefineOpen(true)}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors font-medium disabled:opacity-40"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192z" />
                    </svg>
                    Refine
                  </button>
                )}
                {message.draftStatus === 'ready' && (
                  <button
                    onClick={() => setMarkSentOpen(true)}
                    disabled={busy}
                    className="flex-1 min-w-[120px] py-2 px-3 rounded-xl bg-green-600 text-white text-sm font-medium active:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {t(locale, 'admin_msg_markSent')}
                  </button>
                )}
              </div>
            )}

            {/* Secondary actions row */}
            {isMatched && message.draftStatus !== 'sent' && (
              <div className="px-4 pb-4 flex gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={busy || message.draftStatus === 'pending'}
                  className="py-2 px-3 rounded-xl border border-gray-200 text-xs font-medium text-gray-600 active:bg-gray-50 transition-colors disabled:opacity-40"
                >
                  {t(locale, 'admin_msg_regenerate')}
                </button>
                {message.draftStatus !== 'escalated' && (
                  <button
                    onClick={handleEscalate}
                    disabled={busy}
                    className="py-2 px-3 rounded-xl border border-red-200 text-xs font-medium text-red-600 active:bg-red-50 transition-colors disabled:opacity-40"
                  >
                    {t(locale, 'admin_msg_escalate')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mark as Sent modal */}
      {markSentOpen && (
        <MarkSentModal
          message={message}
          onConfirm={handleMarkSent}
          onCancel={() => setMarkSentOpen(false)}
          locale={locale}
        />
      )}

      <RefineDrawer
        isOpen={refineOpen}
        onClose={() => setRefineOpen(false)}
        draft={message.draftReply || ''}
        context={{
          type: 'reply',
          guestName: message.guestName || message.fromName || 'Guest',
          bookingCode: message.bookingCode,
          inboundMessage: message.body || '',
        }}
        onAccept={async (acceptedDraft) => {
          const { doc: firestoreDoc, updateDoc } = await import('firebase/firestore');
          const { db } = await import('@/lib/firebase');
          await updateDoc(firestoreDoc(db, 'airbnb_messages', message.id), {
            draftReply: acceptedDraft,
            draftStatus: 'ready',
          });
        }}
      />
    </>
  );
}

function AirbnbMessagesView() {
  const { locale } = useLocale();
  const [airbnbMessages, setAirbnbMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'airbnb_messages'),
      orderBy('receivedAt', 'desc')
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setAirbnbMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('Airbnb messages subscription error:', err);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm p-4 flex items-start gap-3 animate-pulse">
            <div className="w-9 h-9 rounded-full bg-gray-100 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-gray-100 rounded w-1/3" />
              <div className="h-3 bg-gray-100 rounded w-2/3" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (airbnbMessages.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-10 text-center">
        <div className="text-gray-300 mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-gray-500 text-sm font-medium">{t(locale, 'admin_msg_airbnbEmpty')}</p>
        <p className="text-gray-400 text-xs mt-1">{t(locale, 'admin_msg_airbnbEmptyDesc')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {airbnbMessages.map((msg) => (
        <AirbnbMessageCard key={msg.id} message={msg} locale={locale} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const { locale } = useLocale();
  const [activeTab, setActiveTab] = useState('inapp');
  const [inAppMessages, setInAppMessages] = useState([]);
  const [airbnbThreadMessages, setAirbnbThreadMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [selectedThread, setSelectedThread] = useState(null);
  const [linkTarget, setLinkTarget] = useState(null); // { threadKey, guestName } or null

  // Subscribe to in-app messages (guest-portal chat)
  useEffect(() => {
    const q = query(collection(db, 'messages'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setInAppMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingMessages(false);
      },
      (err) => {
        console.error('Messages subscription error:', err);
        setLoadingMessages(false);
      }
    );
    return unsubscribe;
  }, []);

  // Subscribe to airbnb_messages too — these include welcome drafts (mark-sent,
  // snoozed, skipped) + parsed Airbnb inbound threads, all grouped by threadKey.
  useEffect(() => {
    const q = query(
      collection(db, 'airbnb_messages'),
      orderBy('receivedAt', 'desc')
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setAirbnbThreadMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.error('airbnb_messages subscription error:', err)
    );
    return unsubscribe;
  }, []);

  // Merge both sources. `buildThreads` groups by threadKey (falling back to
  // bookingCode for legacy in-app docs), so a guest's welcome drafts and
  // portal chat coalesce into one conversation.
  const messages = [...inAppMessages, ...airbnbThreadMessages];
  const threads = buildThreads(messages);

  // Keep selectedThread in sync when messages update
  useEffect(() => {
    if (!selectedThread) return;
    const thr = threads.find((th) => th.threadKey === selectedThread.threadKey);
    if (thr) setSelectedThread(thr);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Full-screen chat view takes over the whole page
  if (selectedThread) {
    return (
      <>
        <ChatView
          thread={selectedThread}
          allMessages={messages}
          onBack={() => setSelectedThread(null)}
          onLinkClick={() => setLinkTarget({ threadKey: selectedThread.threadKey, guestName: selectedThread.guestName })}
        />
        {linkTarget && (
          <LinkToBookingModal
            threadKey={linkTarget.threadKey}
            guestName={linkTarget.guestName}
            user={auth.currentUser}
            locale={locale}
            onLinked={() => {
              setLinkTarget(null);
              // Firestore onSnapshot will refresh threads automatically
            }}
            onCancel={() => setLinkTarget(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-4">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t(locale, 'admin_msg_title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t(locale, 'admin_msg_subtitle')}</p>
      </div>

      {/* Tab toggle */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => setActiveTab('inapp')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'inapp'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 active:bg-white/60'
          }`}
        >
          {t(locale, 'admin_msg_tabInApp')}
        </button>
        <button
          onClick={() => setActiveTab('airbnb')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'airbnb'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 active:bg-white/60'
          }`}
        >
          {t(locale, 'admin_msg_tabAirbnb')}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'inapp' ? (
        loadingMessages ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-gray-100 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-10 text-center">
            <div className="text-gray-300 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 16a2 2 0 01-2 2H7l-4 4V6a2 2 0 012-2h14a2 2 0 012 2v10z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm font-medium">{t(locale, 'admin_msg_emptyTitle')}</p>
            <p className="text-gray-400 text-xs mt-1">{t(locale, 'admin_msg_emptyDesc')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {threads.map((thread) => (
              <ThreadItem key={thread.threadKey} thread={thread} onSelect={setSelectedThread} />
            ))}
          </div>
        )
      ) : (
        <AirbnbMessagesView />
      )}
    </div>
  );
}
