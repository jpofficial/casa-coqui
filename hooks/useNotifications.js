'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
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

    // Build the query. Guests see their own + broadcasts.
    // Staff see everything (admin dashboard query is broader — callers may
    // swap this for a simpler unscoped query when building the admin inbox).
    let q;
    if (bookingCode) {
      // Guests: their booking-specific notifications
      // We listen to two separate queries and merge client-side because
      // Firestore does not support OR queries on different fields.
      // Query A: targeted to this booking
      // Query B: broadcasts
      // This hook subscribes to both and merges the results.
    }

    // For simplicity and to avoid a composite index on `broadcast` + `createdAt`,
    // we query by bookingCode OR fetch broadcasts separately and merge.
    const unsubscribers = [];
    const snapshots = { targeted: [], broadcast: [] };

    function merge() {
      const all = [...snapshots.targeted, ...snapshots.broadcast];
      // Deduplicate by id (a broadcast notification won't also be targeted)
      const seen = new Set();
      const unique = all.filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });
      // Sort newest first
      unique.sort((a, b) => {
        const ta = a.createdAt ?? '';
        const tb = b.createdAt ?? '';
        return tb < ta ? -1 : tb > ta ? 1 : 0;
      });
      setNotifications(unique.slice(0, pageSize));
      setLoading(false);
    }

    if (bookingCode) {
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

      // Query B — broadcasts sent to all active guests
      const qBroadcast = query(
        collection(db, 'notifications'),
        where('broadcast', '==', true),
        orderBy('createdAt', 'desc'),
        limit(pageSize)
      );
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

    return () => unsubscribers.forEach((u) => u());
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
