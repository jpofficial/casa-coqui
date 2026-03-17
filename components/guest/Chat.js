'use client';

import { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  getDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth as firebaseAuth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

// ─── Format time from Firestore Timestamp ─────────────────────────────────────
function formatTime(timestamp, locale) {
  if (!timestamp) return '';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString(locale === 'es' ? 'es-PR' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ─── Date divider ──────────────────────────────────────────────────────────────
function DateDivider({ timestamp, locale }) {
  if (!timestamp) return null;
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  let label;
  if (date.toDateString() === today.toDateString()) {
    label = t(locale, 'chat_today');
  } else if (date.toDateString() === yesterday.toDateString()) {
    label = t(locale, 'chat_yesterday');
  } else {
    label = date.toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', { month: 'short', day: 'numeric' });
  }

  return (
    <div className="flex items-center gap-3 my-2">
      <div className="flex-1 h-px bg-gray-100" />
      <span className="text-xs text-gray-400 font-medium flex-shrink-0">{label}</span>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ message, locale }) {
  const isGuest = message.sender === 'guest';
  const timeStr = formatTime(message.createdAt, locale);

  return (
    <div className={`flex ${isGuest ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] flex flex-col gap-0.5 ${isGuest ? 'items-end' : 'items-start'}`}
      >
        {!isGuest && (
          <span className="text-xs text-gray-500 font-medium px-1 mb-0.5">
            {t(locale, 'chat_host')}
          </span>
        )}
        <div
          className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
            isGuest
              ? 'bg-green-600 text-white rounded-br-sm'
              : 'bg-white border border-gray-200 text-gray-900 rounded-bl-sm shadow-sm'
          } ${message.optimistic ? 'opacity-70' : ''}`}
        >
          {message.text}
        </div>
        <span className="text-xs text-gray-400 px-1">{timeStr}</span>
      </div>
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-sm flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Chat({ code }) {
  const { user } = useAuth();
  const { locale } = useLocale();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guestName, setGuestName] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Fetch guest name from their profile
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'guests', user.uid))
      .then((snap) => {
        if (snap.exists()) setGuestName(snap.data().fullName || null);
      })
      .catch(() => {});
  }, [user]);

  // Real-time message subscription
  useEffect(() => {
    if (!code) return;

    const q = query(
      collection(db, 'messages'),
      where('bookingCode', '==', code),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        // Replace any matching optimistic messages with real ones
        setMessages((prev) => {
          const optimisticIds = new Set(
            prev.filter((m) => m.optimistic).map((m) => m.optimisticKey)
          );
          const realIds = new Set(docs.map((m) => m.id));
          const keptOptimistic = prev.filter(
            (m) => m.optimistic && !realIds.has(m.id)
          );
          return [...docs, ...keptOptimistic].sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() ?? a.createdAt?.getTime?.() ?? 0;
            const bTime = b.createdAt?.toMillis?.() ?? b.createdAt?.getTime?.() ?? 0;
            return aTime - bTime;
          });
        });
        setLoading(false);
      },
      (err) => {
        console.error('Chat listener error:', err);
        setError(t(locale, 'chat_errorLoad'));
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [code]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    const text = inputText.trim();
    if (!text || sending) return;

    setInputText('');
    setSending(true);
    setError(null);

    // Optimistic message — appears immediately in the UI
    const optimisticKey = `optimistic-${Date.now()}`;
    const optimisticMsg = {
      id: optimisticKey,
      optimisticKey,
      optimistic: true,
      bookingCode: code,
      sender: 'guest',
      text,
      createdAt: { toDate: () => new Date(), toMillis: () => Date.now() },
      read: false,
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      await addDoc(collection(db, 'messages'), {
        bookingCode: code,
        sender: 'guest',
        guestId: user?.uid || null,
        guestName: guestName || 'Guest',
        text,
        createdAt: serverTimestamp(),
        read: false,
      });

      // Notify admin of new message (fire-and-forget)
      const idToken = firebaseAuth.currentUser ? await firebaseAuth.currentUser.getIdToken() : null;
      if (idToken) {
        fetch('/api/messages/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ bookingCode: code, sender: 'guest', guestName: guestName || 'Guest' }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Send message error:', err);
      // Remove the optimistic message and restore input on failure
      setMessages((prev) => prev.filter((m) => m.optimisticKey !== optimisticKey));
      setInputText(text);
      setError(t(locale, 'chat_errorSend'));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Group messages by date for dividers
  function shouldShowDateDivider(index) {
    if (index === 0) return true;
    const current = messages[index];
    const previous = messages[index - 1];
    if (!current.createdAt || !previous.createdAt) return false;
    const currentDate = current.createdAt?.toDate?.() ?? new Date(current.createdAt);
    const previousDate = previous.createdAt?.toDate?.() ?? new Date(previous.createdAt);
    return currentDate.toDateString() !== previousDate.toDateString();
  }

  // Gate behind auth — guest must complete check-in first
  if (!user) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex-shrink-0 mb-3">
          <h2 className="text-base font-bold text-gray-900">{t(locale, 'chat_title')}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {t(locale, 'chat_subtitle')}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-amber-500" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">{t(locale, 'chat_requiresCheckin')}</p>
            <p className="text-xs text-gray-400 mt-1">
              {t(locale, 'chat_requiresCheckinDesc')}
            </p>
          </div>
          <a
            href={`/g/${code}/checkin`}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-green-600 hover:text-green-700"
          >
            {t(locale, 'chat_goToCheckin')}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
            </svg>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 mb-3">
        <h2 className="text-base font-bold text-gray-900">{t(locale, 'chat_title')}</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {t(locale, 'chat_subtitle')}
        </p>
      </div>

      {/* Chat container */}
      <div className="flex flex-col flex-1 min-h-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <svg
                className="w-5 h-5 animate-spin text-green-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          )}

          {!loading && messages.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-6 h-6 text-green-400"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700">
                  {t(locale, 'chat_emptyTitle')}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {t(locale, 'chat_emptyDesc')}
                </p>
              </div>
            </div>
          )}

          {!loading &&
            messages.map((message, index) => (
              <div key={message.id}>
                {shouldShowDateDivider(index) && (
                  <DateDivider timestamp={message.createdAt} locale={locale} />
                )}
                <MessageBubble message={message} locale={locale} />
              </div>
            ))}

          {/* Scroll anchor */}
          <div ref={bottomRef} />
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex-shrink-0 px-4 py-2 bg-red-50 border-t border-red-100">
            <p className="text-xs text-red-600" role="alert">
              {error}
            </p>
          </div>
        )}

        {/* Input area — sticky at bottom */}
        <div className="flex-shrink-0 border-t border-gray-100 px-3 py-3 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={1}
              placeholder={t(locale, 'chat_placeholder')}
              aria-label="Message input"
              className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition resize-none disabled:opacity-50 max-h-32 overflow-y-auto"
              style={{ minHeight: '42px' }}
              onInput={(e) => {
                // Auto-grow textarea
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
              }}
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || sending}
              aria-label="Send message"
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-green-600 text-white flex items-center justify-center hover:bg-green-700 active:bg-green-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {sending ? (
                <svg
                  className="w-4 h-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5 px-1">
            {t(locale, 'chat_pressEnter')}
          </p>
        </div>
      </div>
    </div>
  );
}
