'use client';

import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getRelativeTime } from '@/lib/time';
import Link from 'next/link';

const TYPE_STYLES = {
  parking:        { label: 'Parking',        bg: 'bg-atardecer-50',  text: 'text-atardecer-700', border: 'border-atardecer-200' },
  laundry:        { label: 'Laundry',        bg: 'bg-caribe-50',     text: 'text-caribe-700',    border: 'border-caribe-200'    },
  property_issue: { label: 'Property Issue', bg: 'bg-flamboyan-50',  text: 'text-flamboyan-700', border: 'border-flamboyan-200' },
  general:        { label: 'General',        bg: 'bg-coqui-50',      text: 'text-coqui-700',     border: 'border-coqui-200'     },
  noise:          { label: 'Noise',          bg: 'bg-purple-50',     text: 'text-purple-700',    border: 'border-purple-200'    },
  lost_found:     { label: 'Lost & Found',   bg: 'bg-flamboyan-50',  text: 'text-flamboyan-700', border: 'border-flamboyan-200' },
};

/**
 * Shows the latest community board post as a compact preview on the home page.
 * Real-time via onSnapshot. Tapping navigates to the full community board.
 */
export default function CommunityPreview({ code, dateFrom = null, dateTo = null }) {
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const constraints = [orderBy('createdAt', 'desc'), limit(3)];
    if (dateFrom) constraints.push(where('createdAt', '>=', dateFrom));
    if (dateTo) constraints.push(where('createdAt', '<=', dateTo + 'T23:59:59.999Z'));

    const q = query(collection(db, 'community'), ...constraints);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        // Find the first non-deleted post
        const latest = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .find((p) => !p.deletedAt);
        setPost(latest || null);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return unsubscribe;
  }, [dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-3 animate-pulse">
        <div className="h-3 bg-gray-100 rounded w-24 mb-2" />
        <div className="h-3 bg-gray-50 rounded w-full mb-1.5" />
        <div className="h-3 bg-gray-50 rounded w-3/4" />
      </div>
    );
  }

  if (!post) {
    return (
      <Link href={`/g/${code}/community`} className="block">
        <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-3 hover:shadow-md active:scale-[0.99] transition-all duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Community Board</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 text-gray-300">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">{dateFrom ? 'No updates during your stay yet' : 'No updates yet — be the first to post!'}</p>
        </div>
      </Link>
    );
  }

  const style = TYPE_STYLES[post.type] ?? TYPE_STYLES.general;
  const isHost = post.postedByRole === 'admin' || post.postedByRole === 'cohost';
  const relativeTime = getRelativeTime(post.createdAt);

  return (
    <Link href={`/g/${code}/community`} className="block">
      <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-3 hover:shadow-md active:scale-[0.99] transition-all duration-150">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Community Board</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 text-gray-300">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${style.bg} ${style.text} ${style.border}`}>
                {style.label}
              </span>
              {isHost && (
                <span className="text-[10px] font-semibold text-coqui-600">Host</span>
              )}
              {relativeTime && (
                <span className="text-[10px] text-gray-400">{relativeTime}</span>
              )}
            </div>
            <p className="text-sm text-gray-700 leading-snug line-clamp-2">{post.message}</p>
          </div>
          {post.photoUrl && (
            <img
              src={post.photoUrl}
              alt=""
              className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
            />
          )}
        </div>
      </div>
    </Link>
  );
}
