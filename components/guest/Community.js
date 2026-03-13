'use client';

import { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import CommunityPost from './CommunityPost';

// ─── Relative time helper ──────────────────────────────────────────────────────
function getRelativeTime(timestamp) {
  if (!timestamp) return null;
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Type badge ────────────────────────────────────────────────────────────────
const TYPE_STYLES = {
  parking: { label: 'Parking', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  noise: { label: 'Noise', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  lost_found: { label: 'Lost & Found', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  general: { label: 'General', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
};

function TypeBadge({ type }) {
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.general;
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${style.bg} ${style.text} ${style.border}`}>
      {style.label}
    </span>
  );
}

// ─── Avatar helper ─────────────────────────────────────────────────────────────
function PostAvatar({ role }) {
  const isHost = role === 'admin' || role === 'cohost';
  return (
    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isHost ? 'bg-green-600' : 'bg-gray-400'}`}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white" aria-hidden="true">
        <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
      </svg>
    </div>
  );
}

// ─── Reply thread ──────────────────────────────────────────────────────────────
function ReplyThread({ postId }) {
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
    <div className="mt-3 pt-3 border-t border-gray-100">
      {loading ? (
        <p className="text-xs text-gray-400">Loading replies...</p>
      ) : (
        <>
          {replies.length > 0 && (
            <div className="flex flex-col gap-2 mb-3">
              {replies.map((reply) => (
                <div key={reply.id} className="flex gap-2 items-start">
                  <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white" aria-hidden="true">
                      <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 leading-snug">{reply.message}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{getRelativeTime(reply.createdAt)}</p>
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
              placeholder="Write a reply..."
              maxLength={300}
              disabled={sending}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!replyText.trim() || sending}
              className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              {sending ? '...' : 'Send'}
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 flex flex-col gap-2">
          <div className="w-16 h-4 bg-gray-200 rounded-full" />
          <div className="w-3/4 h-4 bg-gray-200 rounded" />
          <div className="w-full h-3 bg-gray-100 rounded" />
        </div>
        <div className="w-8 h-8 bg-gray-200 rounded-full flex-shrink-0" />
      </div>
    </div>
  );
}

// ─── Post card ─────────────────────────────────────────────────────────────────
function PostCard({ post, showBookingCode }) {
  const [showReplies, setShowReplies] = useState(false);
  const relativeTime = getRelativeTime(post.createdAt);
  const isHost = post.postedByRole === 'admin' || post.postedByRole === 'cohost';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-start gap-3">
        <PostAvatar role={post.postedByRole} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-gray-900">
              {isHost ? 'Host' : 'A Guest'}
            </span>
            <TypeBadge type={post.type} />
            {relativeTime && (
              <span className="text-xs text-gray-400">{relativeTime}</span>
            )}
          </div>

          <p className="text-sm text-gray-600 leading-relaxed">{post.message}</p>

          {post.photoUrl && (
            <img
              src={post.photoUrl}
              alt="Post photo"
              className="mt-2 w-full rounded-lg object-cover max-h-60"
            />
          )}

          {showBookingCode && post.bookingCode && (
            <p className="text-xs text-gray-400 mt-1">
              Booking: {post.bookingCode}
            </p>
          )}

          {/* Reply toggle */}
          <button
            type="button"
            onClick={() => setShowReplies(!showReplies)}
            className="mt-2 text-xs text-green-600 font-medium hover:text-green-700 transition-colors"
          >
            {showReplies ? 'Hide replies' : 'Reply'}
          </button>

          {showReplies && <ReplyThread postId={post.id} />}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function Community({ code, showBookingCode = false }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'community'),
      orderBy('createdAt', 'desc'),
      limit(30)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setPosts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('Community board listener error:', err);
        setError('Could not load the community board. Please try again later.');
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-gray-900">Community Board</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Share updates with fellow guests
        </p>
      </div>

      {/* New Post button / form */}
      {showForm ? (
        <CommunityPost
          code={code}
          onClose={() => setShowForm(false)}
          onSuccess={() => setShowForm(false)}
        />
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-xl px-4 py-3 text-sm transition flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Post
        </button>
      )}

      {/* Info notice */}
      <div className="flex gap-2.5 items-start bg-green-50 border border-green-100 rounded-xl p-3">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" aria-hidden="true">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
        </svg>
        <p className="text-xs text-green-800 leading-snug">
          All posts are anonymous. Your identity is never shared with other guests.
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-sm text-red-700">{error}</p>
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
      {!loading && !error && posts.length > 0 && (
        <div className="flex flex-col gap-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} showBookingCode={showBookingCode} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && posts.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-300" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">No posts yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Be the first to share something with fellow guests!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
