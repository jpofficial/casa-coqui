'use client';

import { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  where,
  onSnapshot,
  addDoc,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import CommunityPost from './CommunityPost';
import { getRelativeTime } from '@/lib/time';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

// ─── Type badge ────────────────────────────────────────────────────────────────
const TYPE_STYLES = {
  parking:        { bg: 'bg-atardecer-50',  text: 'text-atardecer-700', border: 'border-atardecer-200', accent: 'bg-atardecer-400' },
  laundry:        { bg: 'bg-caribe-50',     text: 'text-caribe-700',    border: 'border-caribe-200',    accent: 'bg-caribe-400'    },
  property_issue: { bg: 'bg-flamboyan-50',  text: 'text-flamboyan-700', border: 'border-flamboyan-200', accent: 'bg-flamboyan-400' },
  general:        { bg: 'bg-coqui-50',      text: 'text-coqui-700',     border: 'border-coqui-200',     accent: 'bg-coqui-400'     },
  // Legacy types (for backward compatibility with old posts)
  noise:          { bg: 'bg-purple-50',     text: 'text-purple-700',    border: 'border-purple-200',    accent: 'bg-purple-400'    },
  lost_found:     { bg: 'bg-flamboyan-50',  text: 'text-flamboyan-700', border: 'border-flamboyan-200', accent: 'bg-flamboyan-400' },
};

// Maps a post type to its i18n key suffix
const TYPE_KEY = {
  parking:        'parking',
  laundry:        'laundry',
  property_issue: 'propertyIssue',
  general:        'general',
  noise:          'noise',
  lost_found:     'lostFound',
};

function TypeBadge({ type, locale }) {
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.general;
  const labelKey = `communityType_${TYPE_KEY[type] ?? 'general'}`;
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${style.bg} ${style.text} ${style.border}`}>
      {t(locale, labelKey)}
    </span>
  );
}

// Returns the left-bar accent color class for a given post type
function typeAccent(type) {
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.general;
  return style.accent;
}

// ─── Avatar helper ─────────────────────────────────────────────────────────────
function PostAvatar({ role }) {
  const isHost = role === 'admin' || role === 'cohost';
  return (
    <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ring-2 ${isHost ? 'bg-coqui-600 ring-coqui-200' : 'bg-cafe-400 ring-cafe-200'}`}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white" aria-hidden="true">
        <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
      </svg>
    </div>
  );
}

// ─── Reply thread ──────────────────────────────────────────────────────────────
function ReplyThread({ postId, locale }) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // Lazy-load replies when thread is expanded
  useEffect(() => {
    const q = query(
      collection(db, 'community', postId, 'replies'),
      orderBy('createdAt', 'asc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setReplies(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });

    return unsubscribe;
  }, [postId]);

  async function handleSendReply(e) {
    e.preventDefault();
    if (!replyText.trim() || sending) return;

    setSending(true);
    try {
      // Get the user's booking code from their token claims
      const user = auth.currentUser;
      let bookingCode = null;
      if (user) {
        const tokenResult = await user.getIdTokenResult();
        bookingCode = tokenResult.claims.bookingCode || null;
      }

      await addDoc(collection(db, 'community', postId, 'replies'), {
        message: replyText.trim(),
        bookingCode,
        createdAt: new Date().toISOString(),
      });
      setReplyText('');
    } catch (err) {
      console.error('Reply error:', err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-coqui-100">
      {loading ? (
        <p className="text-xs text-coqui-800/50">{t(locale, 'community_loadingReplies')}</p>
      ) : (
        <>
          {replies.length > 0 && (
            <div className="flex flex-col gap-2.5 mb-3">
              {replies.map((reply) => (
                <div key={reply.id} className="flex gap-2 items-start">
                  <div className="w-5 h-5 rounded-full bg-cafe-300 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white" aria-hidden="true">
                      <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0 bg-cafe-50 rounded-lg px-3 py-2">
                    <p className="text-sm text-coqui-900 leading-snug">{reply.message}</p>
                    <p className="text-xs text-coqui-800/50 mt-0.5">{getRelativeTime(reply.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSendReply} className="flex gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={t(locale, 'community_replyPlaceholder')}
              maxLength={300}
              disabled={sending}
              className="admin-input-focus flex-1 rounded-lg border border-cafe-200 px-3 py-2 text-sm text-coqui-900 placeholder-cafe-400 focus:outline-none disabled:opacity-50 bg-white"
            />
            <button
              type="submit"
              disabled={!replyText.trim() || sending}
              className="px-3 py-2 bg-coqui-600 text-white text-sm font-medium rounded-lg hover:bg-coqui-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {sending ? '...' : t(locale, 'community_send')}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────
function PostSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-brand border border-cafe-100 overflow-hidden animate-admin-shimmer">
      <div className="flex items-start gap-3 p-4">
        <div className="w-9 h-9 bg-cafe-200 rounded-full flex-shrink-0" />
        <div className="flex-1 flex flex-col gap-2.5 pt-0.5">
          <div className="flex gap-2 items-center">
            <div className="w-12 h-3.5 bg-cafe-200 rounded-full" />
            <div className="w-16 h-3.5 bg-cafe-100 rounded-full" />
          </div>
          {/* Divider placeholder */}
          <div className="h-px bg-cafe-100 w-full" />
          <div className="w-full h-3.5 bg-cafe-200 rounded" />
          <div className="w-4/5 h-3.5 bg-cafe-100 rounded" />
        </div>
      </div>
    </div>
  );
}

// ─── Post card ─────────────────────────────────────────────────────────────────
function PostCard({ post, showBookingCode, canDelete, onDelete, locale }) {
  const [showReplies, setShowReplies] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const relativeTime = getRelativeTime(post.createdAt);
  const isHost = post.postedByRole === 'admin' || post.postedByRole === 'cohost';
  const accentColor = typeAccent(post.type);

  async function handleDelete() {
    if (!confirm(t(locale, 'community_deletePost'))) return;
    setDeleting(true);
    try {
      await onDelete(post.id);
    } catch (err) {
      console.error('Delete failed:', err);
      setDeleting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-brand border border-cafe-100 overflow-hidden">
      {/* Colored left accent bar per post type */}
      <div className="flex">
        <div className={`w-1 flex-shrink-0 ${accentColor}`} aria-hidden="true" />

        <div className="flex-1 min-w-0 px-4 py-3.5">
          {/* ── Post header ─────────────────────────────── */}
          <div className="flex items-center gap-3">
            <PostAvatar role={post.postedByRole} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-coqui-900">
                  {isHost ? t(locale, 'community_host') : t(locale, 'community_aGuest')}
                </span>
                <TypeBadge type={post.type} locale={locale} />
              </div>
              {relativeTime && (
                <span className="text-xs text-coqui-800/50 mt-0.5 block">{relativeTime}</span>
              )}
            </div>
            {canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="text-coqui-800/30 hover:text-flamboyan-600 transition-colors p-1 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
                aria-label={t(locale, 'community_deletePost')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>

          {/* ── Divider ──────────────────────────────────── */}
          <div className="my-2.5 border-t border-cafe-100" aria-hidden="true" />

          {/* ── Message body ─────────────────────────────── */}
          <p className="text-sm text-coqui-900 leading-relaxed">{post.message}</p>

          {post.photoUrl && (
            <img
              src={post.photoUrl}
              alt={t(locale, 'community_postPhoto')}
              className="mt-3 w-full rounded-lg object-cover max-h-60"
            />
          )}

          {showBookingCode && post.bookingCode && (
            <p className="text-xs text-coqui-800/50 mt-2">
              {t(locale, 'community_booking')} {post.bookingCode}
            </p>
          )}

          {/* ── Reply toggle ─────────────────────────────── */}
          <button
            type="button"
            onClick={() => setShowReplies(!showReplies)}
            className="mt-3 text-xs text-coqui-600 font-semibold hover:text-coqui-700 transition-colors"
          >
            {showReplies ? t(locale, 'community_hideReplies') : t(locale, 'community_reply')}
          </button>

          {showReplies && <ReplyThread postId={post.id} locale={locale} />}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Community({ code, showBookingCode = false, hidePostButton = false, dateFrom = null, dateTo = null, canDelete = false, onDelete = null, initialPostType = null }) {
  const { locale } = useLocale();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(!!initialPostType);

  const isDateScoped = !!(dateFrom || dateTo);
  const visiblePosts = posts.filter((p) => !p.deletedAt);

  useEffect(() => {
    const constraints = [orderBy('createdAt', 'desc'), limit(30)];
    if (dateFrom) constraints.push(where('createdAt', '>=', dateFrom));
    if (dateTo) constraints.push(where('createdAt', '<=', dateTo + 'T23:59:59.999Z'));

    const q = query(collection(db, 'community'), ...constraints);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setPosts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('Community board listener error:', err);
        setError(t(locale, 'community_errorLoad'));
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [dateFrom, dateTo]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-coqui-900">{t(locale, 'community_title')}</h2>
        <p className="text-sm text-coqui-800/60 mt-0.5">
          {t(locale, 'community_subtitle')}
        </p>
      </div>

      {/* New Post button / form */}
      {!hidePostButton && (
        showForm ? (
          <CommunityPost
            code={code}
            initialType={initialPostType}
            onClose={() => setShowForm(false)}
            onSuccess={() => setShowForm(false)}
          />
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full bg-coqui-600 hover:bg-coqui-700 active:bg-coqui-800 text-white font-semibold rounded-xl px-4 py-3 text-sm transition flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t(locale, 'community_newPost')}
          </button>
        )
      )}

      {/* Info notice */}
      <div className="flex gap-2.5 items-start bg-coqui-50 border border-coqui-100 rounded-xl p-3">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-coqui-600 flex-shrink-0 mt-0.5" aria-hidden="true">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
        </svg>
        <p className="text-xs text-coqui-800 leading-snug">
          {t(locale, 'community_anonymousNotice')}
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-flamboyan-50 border border-flamboyan-100 rounded-xl p-4">
          <p className="text-sm text-flamboyan-700">{error}</p>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && !error && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <PostSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Post list */}
      {!loading && !error && visiblePosts.length > 0 && (
        <div className="flex flex-col gap-3">
          {visiblePosts.map((post) => (
            <PostCard key={post.id} post={post} showBookingCode={showBookingCode} canDelete={canDelete} onDelete={onDelete} locale={locale} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && visiblePosts.length === 0 && (
        <div className="bg-white rounded-xl shadow-brand border border-cafe-100 p-8 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-coqui-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-coqui-300" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-coqui-900">
              {isDateScoped ? t(locale, 'community_emptyDateTitle') : t(locale, 'community_emptyTitle')}
            </p>
            <p className="text-xs text-coqui-800/50 mt-1">
              {t(locale, 'community_emptyDesc')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
