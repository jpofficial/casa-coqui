'use client';

import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const DEFAULT_PREFS = { maintenance: true, cleaning: true, assignment: true };

export default function useStaffNotificationPrefs({ staffId } = {}) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!staffId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'staff_notification_prefs', staffId),
      (snap) => {
        if (snap.exists()) {
          setPrefs({ ...DEFAULT_PREFS, ...snap.data() });
        }
        setLoading(false);
      },
      (err) => {
        console.warn('[useStaffNotificationPrefs] error:', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [staffId]);

  const updatePref = useCallback(
    async (key, value) => {
      if (!staffId) return;
      const prev = { ...prefs };
      setPrefs((p) => ({ ...p, [key]: value }));
      try {
        await setDoc(doc(db, 'staff_notification_prefs', staffId), { [key]: value }, { merge: true });
      } catch (err) {
        console.warn('[useStaffNotificationPrefs] save error:', err);
        setPrefs(prev);
      }
    },
    [staffId, prefs]
  );

  return { prefs, loading, updatePref };
}
