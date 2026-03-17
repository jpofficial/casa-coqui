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
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * useStaffNotifications — real-time Firestore listener for the
 * `staff_notifications` collection, scoped to the current staff user.
 *
 * Document shape (staff_notifications/{id}):
 *   recipientId   string   — staff user UID
 *   title         string
 *   body          string
 *   type          string   — 'maintenance', 'cleaning_update', 'assignment', 'staff'
 *   method        string   — 'push' | 'none'
 *   read          bool
 *   readAt        string?  — ISO timestamp when marked read
 *   data          object   — { requestId, category, urgency, targetPath, ... }
 *   createdAt     string   — ISO timestamp
 *
 * @param {object} opts
 * @param {string} opts.staffId  — current staff user UID (required)
 * @param {number} [opts.pageSize=50]
 *
 * @returns {object}
 *   notifications  — sorted array, newest first
 *   unreadCount    — integer
 *   loading        — bool
 *   markRead(id)   — marks a single notification read
 *   markAllRead()  — marks all unread notifications read
 */
export default function useStaffNotifications({ staffId, pageSize = 50 } = {}) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!staffId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'staff_notifications'),
      where('recipientId', '==', staffId),
      orderBy('createdAt', 'desc'),
      limit(pageSize)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setNotifications(items);
        setLoading(false);
      },
      (err) => {
        console.error('[useStaffNotifications] Query error:', err.code, err.message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [staffId, pageSize]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = useCallback(
    async (notificationId) => {
      if (!staffId) return;
      const n = notifications.find((x) => x.id === notificationId);
      if (!n || n.read) return;
      try {
        await updateDoc(doc(db, 'staff_notifications', notificationId), {
          read: true,
          readAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('[useStaffNotifications] markRead error:', err);
      }
    },
    [staffId, notifications]
  );

  const markAllRead = useCallback(async () => {
    if (!staffId) return;
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      unread.forEach((n) => {
        batch.update(doc(db, 'staff_notifications', n.id), {
          read: true,
          readAt: now,
        });
      });
      await batch.commit();
    } catch (err) {
      console.warn('[useStaffNotifications] markAllRead error:', err);
    }
  }, [staffId, notifications]);

  return {
    notifications,
    unreadCount,
    loading,
    markRead,
    markAllRead,
  };
}
