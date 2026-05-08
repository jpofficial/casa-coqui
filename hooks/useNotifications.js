'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * useNotifications — real-time Firestore listener for the notifications
 * collection, scoped to either a guest booking or an admin/staff user.
 *
 * Notifications document shape (notifications/{id}):
 *   bookingCode   string   — for guest-targeted notifications
 *   staffId       string   — for staff-targeted notifications (optional)
 *   broadcast     bool     — true = sent to all active guests
 *   title         string
 *   message       string
 *   category      string   — 'announcement' | 'parking' | 'laundry' |
 *                             'maintenance' | 'community' | 'checkin' | 'general'
 *   createdAt     string   — ISO timestamp
 *   readBy        string[] — array of bookingCodes / staffIds that marked read
 *
 * @param {object} opts
 * @param {string} [opts.bookingCode]  — pass for guest context
 * @param {string} [opts.staffId]      — pass for admin/staff context
 * @param {number} [opts.pageSize=40]
 *
 * @returns {object}
 *   notifications  — sorted array, newest first
 *   unreadCount    — integer
 *   loading        — bool
 *   markRead(id)   — marks a single notification read
 *   markAllRead()  — marks all unread notifications read
 */
export default function useNotifications({ bookingCode, staffId, pageSize = 40 } = {}) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  // Reader identity: guests use bookingCode, staff use staffId
  const readerKey = bookingCode || staffId || null;

  useEffect(() => {
    if (!readerKey) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    const unsubscribers = [];
    const snapshots = { targeted: [], broadcast: [] };

    function merge() {
      const all = [...snapshots.targeted, ...snapshots.broadcast];
      const seen = new Set();
      const unique = all.filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });
      unique.sort((a, b) => {
        const ta = a.createdAt ?? '';
        const tb = b.createdAt ?? '';
        return tb < ta ? -1 : tb > ta ? 1 : 0;
      });
      setNotifications(unique.slice(0, pageSize));
      setLoading(false);
    }

    async function subscribe() {
      if (bookingCode) {
        // Look up the booking's check-in date so we only show broadcasts
        // that were sent during or after this guest's stay. Without this,
        // a new guest would see old broadcasts from prior bookings.
        let since = null;
        try {
          const bookingSnap = await getDocs(
            query(collection(db, 'bookings'), where('code', '==', bookingCode), limit(1))
          );
          if (!bookingSnap.empty) {
            since = bookingSnap.docs[0].data().checkInDate || null;
          }
        } catch (err) {
          console.warn('[useNotifications] booking lookup error:', err.message);
        }

        if (cancelled) return;

        // Query A — notifications targeted at this booking
        const qTargeted = query(
          collection(db, 'notifications'),
          where('bookingCode', '==', bookingCode),
          orderBy('createdAt', 'desc'),
          limit(pageSize)
        );
        unsubscribers.push(
          onSnapshot(qTargeted, (snap) => {
            snapshots.targeted = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            merge();
          }, (err) => {
            console.error('[useNotifications] targeted query error:', err.code);
            setLoading(false);
          })
        );

        // Query B — broadcasts, time-scoped to this booking's check-in date
        const broadcastFilters = [
          where('broadcast', '==', true),
          ...(since ? [where('createdAt', '>=', since)] : []),
          orderBy('createdAt', 'desc'),
          limit(pageSize),
        ];
        const qBroadcast = query(collection(db, 'notifications'), ...broadcastFilters);
        unsubscribers.push(
          onSnapshot(qBroadcast, (snap) => {
            snapshots.broadcast = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            merge();
          }, (err) => {
            console.error('[useNotifications] broadcast query error:', err.code);
            setLoading(false);
          })
        );
      } else if (staffId) {
        // Staff: all notifications (admin inbox) — no bookingCode filter
        const qAll = query(
          collection(db, 'notifications'),
          orderBy('createdAt', 'desc'),
          limit(pageSize)
        );
        unsubscribers.push(
          onSnapshot(qAll, (snap) => {
            snapshots.targeted = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            merge();
          }, (err) => {
            console.error('[useNotifications] staff query error:', err.code);
            setLoading(false);
          })
        );
      }
    }

    subscribe();

    return () => {
      cancelled = true;
      unsubscribers.forEach((u) => u());
    };
  }, [readerKey, bookingCode, staffId, pageSize]);

  // A notification is "read" when readerKey appears in its readBy array
  const isRead = useCallback((n) => {
    if (!readerKey) return true;
    return Array.isArray(n.readBy) && n.readBy.includes(readerKey);
  }, [readerKey]);

  const unreadCount = notifications.filter((n) => !isRead(n)).length;

  const markRead = useCallback(async (notificationId) => {
    if (!readerKey) return;
    try {
      const n = notifications.find((x) => x.id === notificationId);
      if (!n || isRead(n)) return;
      const existing = Array.isArray(n.readBy) ? n.readBy : [];
      await updateDoc(doc(db, 'notifications', notificationId), {
        readBy: [...existing, readerKey],
      });
    } catch (err) {
      console.warn('[useNotifications] markRead error:', err);
    }
  }, [readerKey, notifications, isRead]);

  const markAllRead = useCallback(async () => {
    if (!readerKey) return;
    const unread = notifications.filter((n) => !isRead(n));
    if (unread.length === 0) return;
    try {
      const batch = writeBatch(db);
      unread.forEach((n) => {
        const existing = Array.isArray(n.readBy) ? n.readBy : [];
        batch.update(doc(db, 'notifications', n.id), {
          readBy: [...existing, readerKey],
        });
      });
      await batch.commit();
    } catch (err) {
      console.warn('[useNotifications] markAllRead error:', err);
    }
  }, [readerKey, notifications, isRead]);

  return {
    notifications,
    unreadCount,
    loading,
    isRead,
    markRead,
    markAllRead,
  };
}
