'use client';

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, auth, storage } from '@/lib/firebase';
import useLocale from '@/hooks/useLocale';
import useAuth from '@/hooks/useAuth';
import { t } from '@/lib/i18n';

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(locale, dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString(locale === 'es' ? 'es-PR' : 'en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// ─── Chat Bubble ────────────────────────────────────────────────────────────
// Renders like a WhatsApp message — host on the left, cleaner on the right.
function ChatBubble({ post, isOwnMessage }) {
  const isHost = post.sender === 'host' || post.sender === 'system';
  const hasImages = post.imageUrls?.length > 0;
  const hasText = !!post.text;

  return (
    <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} py-0.5`}>
      <div className={`max-w-[82%] rounded-2xl overflow-hidden ${
        isOwnMessage
          ? 'bg-coqui-600 text-white rounded-br-sm'
          : 'bg-white text-coqui-900 shadow-sm rounded-bl-sm'
      }`}>
        {/* Sender name (only for incoming messages) */}
        {!isOwnMessage && (
          <p className={`text-[10px] font-semibold px-3 pt-2 ${
            isHost ? 'text-caribe-600' : 'text-coqui-500'
          }`}>
            {post.senderName}
          </p>
        )}

        {/* Images — full-bleed inside the bubble */}
        {hasImages && (
          <div className={`${hasText ? '' : (!isOwnMessage ? 'pt-0' : '')} ${
            post.imageUrls.length === 1 ? '' : 'grid grid-cols-2 gap-0.5'
          } ${hasText ? 'px-1 pt-1' : (isOwnMessage ? 'p-1' : 'px-1 pb-0 pt-1')}`}>
            {post.imageUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                className={`object-cover rounded-xl ${
                  post.imageUrls.length === 1
                    ? 'w-full max-h-64'
                    : 'w-full aspect-square'
                }`}
              />
            ))}
          </div>
        )}

        {/* Text */}
        {hasText && (
          <p className={`text-[14px] leading-relaxed whitespace-pre-wrap break-words px-3 ${
            hasImages ? 'pt-1.5' : 'pt-2'
          } ${isOwnMessage ? '' : ''}`}>
            {post.text}
          </p>
        )}

        {/* Timestamp */}
        <p className={`text-[10px] px-3 pb-1.5 ${hasText ? 'pt-0.5' : 'pt-1'} ${
          isOwnMessage ? 'text-white/50 text-right' : 'text-coqui-800/30 text-right'
        }`}>
          {fmtTime(post.createdAt)}
        </p>
      </div>
    </div>
  );
}

// ─── Status Pill (like WhatsApp date separator) ─────────────────────────────
function StatusPill({ post, locale }) {
  const label = t(locale, post.newStatus || 'scheduled');
  return (
    <div className="flex justify-center py-2">
      <span className="text-[11px] font-medium text-coqui-800/50 bg-cafe-100/80 backdrop-blur-sm px-3 py-1 rounded-full">
        {label} · {fmtTime(post.createdAt)}
      </span>
    </div>
  );
}

// ─── Laundry Result (small inline card) ─────────────────────────────────────
function LaundryBubble({ post, locale }) {
  return (
    <div className="flex justify-center py-1">
      <div className={`text-[12px] font-medium px-3.5 py-2 rounded-2xl ${
        post.laundryFound
          ? 'bg-amber-50 text-amber-700'
          : 'bg-coqui-50 text-coqui-700'
      }`}>
        <span>{post.laundryFound ? '👕 ' + t(locale, 'forum_laundryFound') : '✓ ' + t(locale, 'forum_laundryClean')}</span>
        {post.text && <span className="block text-[11px] opacity-70 mt-0.5">{post.text}</span>}
        {post.imageUrls?.length > 0 && (
          <div className="flex gap-1 mt-1.5">
            {post.imageUrls.map((url, i) => (
              <img key={i} src={url} alt="" className="w-14 h-14 object-cover rounded-lg" />
            ))}
          </div>
        )}
        <span className="block text-[10px] opacity-40 mt-0.5 text-right">{fmtTime(post.createdAt)}</span>
      </div>
    </div>
  );
}

// ─── Quick Reply Actions ────────────────────────────────────────────────────
// Context-aware action chips at the bottom, like Messenger quick replies.
function QuickActions({ job, locale, onAction, busy }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [laundryNote, setLaundryNote] = useState('');
  const fileInputId = useId();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const status = job.status;

  if (status === 'completed' || status === 'declined') return null;

  // Photo upload handler (for before/after photos)
  async function handlePhotoFiles(e, photoType, nextStatus) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress(0);

    const urls = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
      const storageRef = ref(storage, `cleaning/${job.id}/${photoType}/${filename}`);
      const snap = await uploadBytesResumable(storageRef, file);
      const url = await getDownloadURL(snap.ref);
      urls.push(url);
      setUploadProgress(Math.round(((i + 1) / files.length) * 100));
    }

    await onAction({ photoType, urls, nextStatus });
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  // Accept / Decline
  if (status === 'scheduled') {
    if (declining) {
      return (
        <div className="space-y-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t(locale, 'declineReasonPlaceholder')}
            className="w-full text-sm border border-gray-200 rounded-full px-4 py-2.5
              focus:outline-none focus:ring-2 focus:ring-flamboyan-200"
            autoFocus
          />
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => { onAction({ status: 'declined', declineReason: reason.trim() }); setDeclining(false); }}
              disabled={!reason.trim() || busy}
              className="text-sm font-semibold px-5 py-2 rounded-full bg-flamboyan-600 text-white
                disabled:opacity-50 transition-colors"
            >
              {t(locale, 'submitDecline')}
            </button>
            <button
              onClick={() => { setDeclining(false); setReason(''); }}
              className="text-sm text-gray-400 px-3 py-2"
            >
              {t(locale, 'cancel')}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex gap-2 justify-center">
        <button
          onClick={() => onAction({ status: 'acknowledged' })}
          disabled={busy}
          className="text-sm font-semibold px-6 py-2.5 rounded-full bg-coqui-600 text-white
            active:bg-coqui-700 disabled:opacity-50 transition-colors"
        >
          {busy ? '...' : t(locale, 'forum_actionAccept')}
        </button>
        <button
          onClick={() => setDeclining(true)}
          disabled={busy}
          className="text-sm font-semibold px-6 py-2.5 rounded-full border border-flamboyan-300 text-flamboyan-600
            active:bg-flamboyan-50 disabled:opacity-50 transition-colors"
        >
          {t(locale, 'forum_actionDecline')}
        </button>
      </div>
    );
  }

  // Single action buttons
  const singleActions = {
    acknowledged: { label: 'forum_actionEnRoute', color: 'bg-indigo-600 active:bg-indigo-700' },
    en_route: { label: 'forum_actionArrived', color: 'bg-purple-600 active:bg-purple-700' },
    cleaning: { label: 'forum_actionDoneCleaning', color: 'bg-amber-600 active:bg-amber-700' },
  };

  const singleStatusMap = {
    acknowledged: 'en_route',
    en_route: 'arrived',
    cleaning: 'after_photos',
  };

  if (singleActions[status]) {
    const { label, color } = singleActions[status];
    return (
      <div className="flex justify-center">
        <button
          onClick={() => onAction({ status: singleStatusMap[status] })}
          disabled={busy}
          className={`text-sm font-semibold px-8 py-2.5 rounded-full text-white
            disabled:opacity-50 transition-colors ${color}`}
        >
          {busy ? '...' : t(locale, label)}
        </button>
      </div>
    );
  }

  // Before / After photos
  if (status === 'arrived' || status === 'before_photos') {
    const photoType = 'before';
    const nextStatus = 'cleaning';
    return (
      <div className="flex justify-center">
        <input
          ref={fileRef}
          id={fileInputId + '-before'}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handlePhotoFiles(e, photoType, nextStatus)}
        />
        <label
          htmlFor={fileInputId + '-before'}
          className={`text-sm font-semibold px-6 py-2.5 rounded-full bg-coqui-600 text-white
            active:bg-coqui-700 cursor-pointer transition-colors inline-flex items-center gap-2 ${
            uploading ? 'opacity-60 pointer-events-none' : ''
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
          </svg>
          {uploading ? `${uploadProgress}%` : t(locale, 'forum_actionBeforePhotos')}
        </label>
      </div>
    );
  }

  if (status === 'after_photos') {
    const photoType = 'after';
    const nextStatus = 'laundry_check';
    return (
      <div className="flex justify-center">
        <input
          ref={fileRef}
          id={fileInputId + '-after'}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handlePhotoFiles(e, photoType, nextStatus)}
        />
        <label
          htmlFor={fileInputId + '-after'}
          className={`text-sm font-semibold px-6 py-2.5 rounded-full bg-coqui-600 text-white
            active:bg-coqui-700 cursor-pointer transition-colors inline-flex items-center gap-2 ${
            uploading ? 'opacity-60 pointer-events-none' : ''
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
          </svg>
          {uploading ? `${uploadProgress}%` : t(locale, 'forum_actionAfterPhotos')}
        </label>
      </div>
    );
  }

  // Laundry check
  if (status === 'laundry_check') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-center text-coqui-800/50">{t(locale, 'forum_laundryQuestion')}</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => onAction({ status: 'completed', laundryFound: false })}
            disabled={busy}
            className="text-sm font-semibold px-5 py-2.5 rounded-full bg-coqui-100 text-coqui-700
              active:bg-coqui-200 disabled:opacity-50 transition-colors"
          >
            {t(locale, 'forum_actionLaundryNo')}
          </button>
          <button
            onClick={() => onAction({
              status: 'completed',
              laundryFound: true,
              laundryNote: laundryNote.trim() || undefined,
            })}
            disabled={busy}
            className="text-sm font-semibold px-5 py-2.5 rounded-full bg-amber-100 text-amber-700
              active:bg-amber-200 disabled:opacity-50 transition-colors"
          >
            {t(locale, 'forum_actionLaundryYes')}
          </button>
        </div>
        <input
          type="text"
          value={laundryNote}
          onChange={(e) => setLaundryNote(e.target.value)}
          placeholder={t(locale, 'forum_laundryDescribe')}
          className="w-full text-xs border border-gray-200 rounded-full px-4 py-2
            focus:outline-none focus:ring-2 focus:ring-coqui-200 placeholder:text-gray-400"
        />
      </div>
    );
  }

  return null;
}

// ─── Input Bar (WhatsApp style) ─────────────────────────────────────────────
function ChatInput({ jobId, locale, onPost }) {
  const [text, setText] = useState('');
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const fileInputId = useId();

  async function uploadFile(file) {
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const storageRef = ref(storage, `cleaning/${jobId}/messages/${filename}`);
    const snap = await uploadBytesResumable(storageRef, file);
    return getDownloadURL(snap.ref);
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    const urls = [];
    for (const file of files) {
      const url = await uploadFile(file);
      urls.push(url);
    }
    setPendingPhotos((prev) => [...prev, ...urls]);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleSend() {
    if (!text.trim() && pendingPhotos.length === 0) return;
    setSending(true);
    await onPost({ text: text.trim() || null, imageUrls: pendingPhotos });
    setText('');
    setPendingPhotos([]);
    setSending(false);
  }

  return (
    <div className="space-y-2">
      {/* Pending photo previews */}
      {pendingPhotos.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto px-1">
          {pendingPhotos.map((url, i) => (
            <div key={i} className="relative flex-shrink-0">
              <img src={url} alt="" className="w-12 h-12 object-cover rounded-lg" />
              <button
                onClick={() => setPendingPhotos((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full
                  flex items-center justify-center text-[9px] font-bold"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        {/* Photo attach */}
        <input
          ref={fileRef}
          id={fileInputId}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFiles}
        />
        <label
          htmlFor={fileInputId}
          className={`flex-shrink-0 w-10 h-10 rounded-full bg-cafe-100 flex items-center justify-center
            cursor-pointer active:bg-cafe-200 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {uploading ? (
            <div className="w-4 h-4 border-2 border-coqui-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5 text-coqui-800/50">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
          )}
        </label>

        {/* Text input — rounded like WhatsApp */}
        <div className="flex-1">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={t(locale, 'forum_typeMessage')}
            className="w-full text-sm bg-cafe-50 border border-cafe-200 rounded-full px-4 py-2.5
              focus:outline-none focus:ring-2 focus:ring-coqui-200 placeholder:text-coqui-800/30"
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={sending || (!text.trim() && pendingPhotos.length === 0)}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-coqui-600 text-white flex items-center justify-center
            active:bg-coqui-700 disabled:opacity-30 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Main: JobForum ─────────────────────────────────────────────────────────
export default function JobForum({ job, onClose }) {
  const { locale } = useLocale();
  const { user, role } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const feedRef = useRef(null);
  const prevCountRef = useRef(0);

  const isAdmin = role === 'admin' || role === 'cohost';

  // Real-time listener for posts sub-collection
  useEffect(() => {
    const q = query(
      collection(db, 'cleaning_jobs', job.id, 'posts'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q,
      (snap) => {
        setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('[JobForum] posts listener error:', err.code, err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [job.id]);

  // Auto-scroll to bottom on new posts
  useEffect(() => {
    if (posts.length > prevCountRef.current && feedRef.current) {
      setTimeout(() => {
        feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
    prevCountRef.current = posts.length;
  }, [posts.length]);

  // API helper
  const apiCall = useCallback(async (path, body, method = 'PATCH') => {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.json();
  }, []);

  // Handle quick-action taps
  const handleAction = useCallback(async (action) => {
    setBusy(true);
    try {
      if (action.photoType) {
        await apiCall(
          `/api/cleaning/jobs/${job.id}/photos`,
          { type: action.photoType, urls: action.urls },
          'POST'
        );
        if (action.nextStatus) {
          await apiCall(`/api/cleaning/jobs/${job.id}`, { status: action.nextStatus });
        }
      } else {
        await apiCall(`/api/cleaning/jobs/${job.id}`, action);
      }
    } catch (err) {
      console.error('[JobForum] action error:', err);
    } finally {
      setBusy(false);
    }
  }, [job.id, apiCall]);

  // Send a chat message
  const handlePost = useCallback(async ({ text, imageUrls }) => {
    try {
      await apiCall(`/api/cleaning/jobs/${job.id}/posts`, { text, imageUrls }, 'POST');
    } catch (err) {
      console.error('[JobForum] post error:', err);
    }
  }, [job.id, apiCall]);

  // Render a single post
  function renderPost(post) {
    if (post.type === 'status') {
      return <StatusPill key={post.id} post={post} locale={locale} />;
    }
    if (post.type === 'laundry') {
      return <LaundryBubble key={post.id} post={post} locale={locale} />;
    }
    // Everything else (message, before_photos, after_photos) → chat bubble
    return (
      <ChatBubble
        key={post.id}
        post={post}
        isOwnMessage={post.senderId === user?.uid}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#e8ded4] flex flex-col">
      {/* ── Header (WhatsApp-style) ──────────────────────────────────── */}
      <div className="bg-coqui-700 text-white px-3 pt-3 pb-2.5 flex-shrink-0 safe-area-top">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
              active:bg-white/10 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>

          {/* Job avatar */}
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold flex-shrink-0">
            {job.unit?.charAt(0) || '?'}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{job.unit}</p>
            <p className="text-[11px] text-white/60">
              {fmtDate(locale, job.scheduledDate)} · {t(locale, job.status)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Chat Feed ────────────────────────────────────────────────── */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23c9b99a\' fill-opacity=\'0.08\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }}
      >
        {/* Job info mini-card at top */}
        <div className="flex justify-center mb-3">
          <div className="bg-white/80 backdrop-blur-sm rounded-xl px-3.5 py-2 text-center shadow-sm max-w-[85%]">
            <p className="text-[11px] font-semibold text-coqui-800">{job.unit} — {fmtDate(locale, job.scheduledDate)}</p>
            <p className="text-[10px] text-coqui-800/50">
              {t(locale, 'checkoutTime')}: {job.checkoutTime || '11:00 AM'}
              {job.sameDayArrival ? ` · ${t(locale, 'sameDayArrival')}` : ''}
            </p>
            {job.turnoverNotes && (
              <p className="text-[10px] text-coqui-800/60 mt-1 italic">{job.turnoverNotes}</p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-coqui-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-0.5">
            {posts.map(renderPost)}
          </div>
        )}
      </div>

      {/* ── Bottom: Quick Actions + Chat Input ────────────────────────── */}
      <div className="bg-white border-t border-cafe-200 px-3 py-2.5 space-y-2 flex-shrink-0 safe-area-bottom">
        {/* Quick action chips — only for cleaners */}
        {!isAdmin && (
          <QuickActions
            job={job}
            locale={locale}
            onAction={handleAction}
            busy={busy}
          />
        )}

        {/* Chat input — always visible */}
        <ChatInput
          jobId={job.id}
          locale={locale}
          onPost={handlePost}
        />
      </div>
    </div>
  );
}
