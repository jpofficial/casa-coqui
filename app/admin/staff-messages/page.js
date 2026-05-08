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
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from '@/lib/firebase';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

function timeAgo(dateValue, locale) {
  if (!dateValue) return '';
  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
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
  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  return date.toLocaleTimeString(locale === 'es' ? 'es' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateDivider(dateValue, locale) {
  if (!dateValue) return '';
  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t(locale, 'admin_msg_today');
  if (date.toDateString() === yesterday.toDateString()) return t(locale, 'admin_msg_yesterday');
  return date.toLocaleDateString(locale === 'es' ? 'es' : 'en-US', { month: 'short', day: 'numeric' });
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'string') return new Date(v).getTime();
  if (v?.toDate) return v.toDate().getTime();
  return new Date(v).getTime();
}

function buildThreads(messages) {
  const threadMap = {};
  for (const msg of messages) {
    const sid = msg.staffId || 'unknown';
    if (!threadMap[sid]) {
      threadMap[sid] = {
        staffId: sid,
        staffName: msg.staffName || sid,
        messages: [],
        lastMessage: null,
        unreadCount: 0,
      };
    }
    threadMap[sid].messages.push(msg);
    if (!threadMap[sid].lastMessage || toMs(msg.createdAt) > toMs(threadMap[sid].lastMessage.createdAt)) {
      threadMap[sid].lastMessage = msg;
    }
    // Update staffName to the most recent one
    if (msg.staffName) threadMap[sid].staffName = msg.staffName;
    if (msg.sender === 'staff' && !msg.read) {
      threadMap[sid].unreadCount += 1;
    }
  }
  return Object.values(threadMap).sort((a, b) =>
    toMs(b.lastMessage?.createdAt) - toMs(a.lastMessage?.createdAt)
  );
}

function groupByDay(messages, locale) {
  const sorted = [...messages].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
  const groups = [];
  let currentDay = null;
  for (const msg of sorted) {
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
function ThreadItem({ thread, onSelect, locale }) {
  const last = thread.lastMessage;
  return (
    <button
      onClick={() => onSelect(thread)}
      className="w-full bg-white rounded-xl shadow-sm p-4 text-left flex items-start gap-3 active:bg-gray-50 transition-colors"
    >
      <div className="w-10 h-10 rounded-full bg-[#25D366]/10 flex items-center justify-center flex-shrink-0 text-[#25D366] font-bold text-sm uppercase">
        {(thread.staffName || 'S').charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-semibold text-gray-900 truncate">
            {thread.staffName}
          </span>
          <span className="text-[11px] text-gray-400 flex-shrink-0">{timeAgo(last?.createdAt, locale)}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-xs text-gray-500 truncate flex-1">
            {last?.sender === 'host' ? t(locale, 'admin_msg_you') + ' ' : ''}
            {last?.text || (last?.imageUrls?.length > 0 ? t(locale, 'admin_msg_photo') : '')}
          </p>
          {thread.unreadCount > 0 && (
            <span className="flex-shrink-0 bg-[#25D366] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {thread.unreadCount > 9 ? '9+' : thread.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// Chat view for a single staff thread
function ChatView({ thread, allMessages, onBack }) {
  const { locale } = useLocale();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingImages, setPendingImages] = useState([]); // { file, preview }
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  const threadMessages = allMessages
    .filter((m) => m.staffId === thread.staffId)
    .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));

  const grouped = groupByDay(threadMessages, locale);

  // Mark unread staff messages as read
  useEffect(() => {
    const unread = threadMessages.filter((m) => m.sender === 'staff' && !m.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach((m) => {
      batch.update(doc(db, 'staff_messages', m.id), { read: true });
    });
    batch.commit().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.staffId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages.length]);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 3 - pendingImages.length;
    const toAdd = files.slice(0, remaining).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setPendingImages((prev) => [...prev, ...toAdd]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removePending(idx) {
    setPendingImages((prev) => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  // Find latest jobId for storage path + Firestore doc
  const latestJobId = [...threadMessages].reverse().find((m) => m.jobId)?.jobId || null;

  async function uploadPendingImages() {
    const results = [];
    const storagePath = latestJobId ? `cleaning_jobs/${latestJobId}/chat` : `staff_messages/${thread.staffId}`;
    for (const img of pendingImages) {
      const ext = img.file.name.split('.').pop() || 'jpg';
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const storageRef = ref(storage, `${storagePath}/${filename}`);
      const snap = await uploadBytesResumable(storageRef, img.file);
      const url = await getDownloadURL(snap.ref);
      results.push(url);
    }
    return results;
  }

  const canSend = (text.trim() || pendingImages.length > 0) && !sending;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setSending(true);
    const trimmed = text.trim();
    setText('');
    try {
      // Upload pending images first
      let imageUrls = [];
      if (pendingImages.length > 0) {
        imageUrls = await uploadPendingImages();
      }

      const notifyText = trimmed || t(locale, 'sentPhoto');

      await addDoc(collection(db, 'staff_messages'), {
        staffId: thread.staffId,
        staffName: thread.staffName,
        sender: 'host',
        text: trimmed,
        read: false,
        createdAt: new Date().toISOString(),
        ...(latestJobId && { jobId: latestJobId }),
        ...(imageUrls.length > 0 && { imageUrls }),
      });

      // Notify the staff member
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      if (idToken) {
        fetch('/api/staff-messages/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ staffId: thread.staffId, sender: 'host', text: notifyText }),
        }).catch(() => {});
      }

      pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
      setPendingImages([]);
    } catch (err) {
      console.error('Failed to send message:', err);
      setText(trimmed);
    } finally {
      setSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, sending, pendingImages, thread.staffId, thread.staffName, latestJobId, locale]);

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
          className="text-[#25D366] min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2"
          aria-label={t(locale, 'admin_msg_back')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="w-8 h-8 rounded-full bg-[#25D366]/10 flex items-center justify-center text-[#25D366] font-bold text-sm uppercase flex-shrink-0">
          {(thread.staffName || 'S').charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{thread.staffName}</p>
          <p className="text-xs text-gray-400">{t(locale, 'admin_staffMsg_viaWhatsApp')}</p>
        </div>
      </div>

      {/* Messages */}
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
          return (
            <div key={item.key} className={`flex ${isHost ? 'justify-end' : 'justify-start'} mt-1`}>
              <div
                className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl text-sm leading-snug shadow-sm ${
                  isHost
                    ? 'bg-[#25D366] text-white rounded-br-sm'
                    : 'bg-white text-gray-800 rounded-bl-sm'
                }`}
              >
                {msg.imageUrls?.length > 0 && (
                  <div className={`flex gap-1 flex-wrap ${msg.text ? 'mb-1.5' : ''}`}>
                    {msg.imageUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                        <img
                          src={url}
                          alt=""
                          className="rounded-lg max-w-[180px] max-h-[140px] object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                )}
                {msg.text && <p>{msg.text}</p>}
                <p className={`text-[10px] mt-1 ${isHost ? 'text-green-200' : 'text-gray-400'} text-right`}>
                  {formatTime(msg.createdAt, locale)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Pending photo strip + Reply input */}
      <div className="bg-white border-t border-gray-100 flex-shrink-0">
        {pendingImages.length > 0 && (
          <div className="px-4 pt-2 flex gap-2 overflow-x-auto">
            {pendingImages.map((img, idx) => (
              <div key={idx} className="relative flex-shrink-0">
                <img src={img.preview} alt="" className="w-14 h-14 rounded-lg object-cover" />
                <button
                  onClick={() => removePending(idx)}
                  className="absolute -top-1 -right-1 bg-gray-800/70 text-white rounded-full w-5 h-5 flex items-center justify-center"
                  aria-label={t(locale, 'removePhoto')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {sending && (
              <div className="flex items-center text-xs text-gray-400 pl-1">
                {t(locale, 'uploadingPhoto')}
              </div>
            )}
          </div>
        )}
        <div className="px-4 py-3 flex items-end gap-2">
          {/* Attach photo button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={pendingImages.length >= 3 || sending}
            className="text-gray-400 hover:text-[#25D366] disabled:text-gray-200 transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label={t(locale, 'attachPhoto')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-5.5 h-5.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t(locale, 'admin_staffMsg_placeholder')}
            rows={1}
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#25D366]/50 focus:border-transparent resize-none max-h-32"
            style={{ minHeight: '44px' }}
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="bg-[#25D366] text-white rounded-xl p-3 flex-shrink-0 disabled:opacity-50 active:bg-[#20bd5a] transition-colors"
            aria-label={t(locale, 'admin_msg_send')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StaffMessagesPage() {
  const { locale } = useLocale();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedThread, setSelectedThread] = useState(null);

  useEffect(() => {
    const q = query(collection(db, 'staff_messages'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('Staff messages subscription error:', err);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  const threads = buildThreads(messages);

  // Keep selectedThread in sync
  useEffect(() => {
    if (!selectedThread) return;
    const thr = threads.find((th) => th.staffId === selectedThread.staffId);
    if (thr) setSelectedThread(thr);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  if (selectedThread) {
    return (
      <ChatView
        thread={selectedThread}
        allMessages={messages}
        onBack={() => setSelectedThread(null)}
      />
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t(locale, 'admin_staffMsg_title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t(locale, 'admin_staffMsg_subtitle')}</p>
      </div>

      {loading ? (
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
          <p className="text-gray-400 text-sm font-medium">{t(locale, 'admin_staffMsg_emptyTitle')}</p>
          <p className="text-gray-400 text-xs mt-1">{t(locale, 'admin_staffMsg_emptyDesc')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <ThreadItem key={thread.staffId} thread={thread} onSelect={setSelectedThread} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}
