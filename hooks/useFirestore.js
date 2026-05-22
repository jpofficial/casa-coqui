'use client';

import { useState, useEffect, useRef } from 'react';
import { doc, collection, onSnapshot, query } from 'firebase/firestore';
import { onIdTokenChanged } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';

const MAX_CLAIMS_RETRIES = 4;
const RETRY_DELAY_MS = 1500;

// Sets up a one-shot retry trigger that fires when either:
//   1. Firebase Auth reports a token change (custom claims refreshed), OR
//   2. A timer expires.
// Whichever fires first wins; the other is cleared. The timer fallback exists
// because onIdTokenChanged is unreliable in Safari Private/Incognito mode
// (IndexedDB restrictions) and we cannot wait forever for an event that may
// never come.
function setupClaimsRetry(onTrigger) {
  let unsubTokenChange = null;
  let timerId = null;
  let fired = false;

  const fire = () => {
    if (fired) return;
    fired = true;
    if (unsubTokenChange) { unsubTokenChange(); unsubTokenChange = null; }
    if (timerId) { clearTimeout(timerId); timerId = null; }
    onTrigger();
  };

  unsubTokenChange = onIdTokenChanged(auth, (u) => { if (u) fire(); });
  timerId = setTimeout(fire, RETRY_DELAY_MS);

  return () => {
    if (unsubTokenChange) { unsubTokenChange(); unsubTokenChange = null; }
    if (timerId) { clearTimeout(timerId); timerId = null; }
  };
}

export function useDocument(collectionName, docId) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [claimsRetry, setClaimsRetry] = useState(0);
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (authLoading) return;

    if (!user || !docId) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let cancelRetry = null;
    const unsub = onSnapshot(
      doc(db, collectionName, docId),
      (snapshot) => {
        setData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        setLoading(false);
        retryCountRef.current = 0;
      },
      (err) => {
        console.error(`[Firestore] ${collectionName}/${docId} listener error:`, err.code, err.message);
        setError(err);
        setLoading(false);
        if (err.code === 'permission-denied' && retryCountRef.current < MAX_CLAIMS_RETRIES) {
          retryCountRef.current += 1;
          cancelRetry = setupClaimsRetry(() => setClaimsRetry((n) => n + 1));
        }
      }
    );

    return () => {
      unsub();
      if (cancelRetry) cancelRetry();
    };
  }, [user, authLoading, collectionName, docId, claimsRetry]);

  return { data, loading: authLoading || loading, error };
}

export function useCollection(collectionName, queryConstraints = []) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [claimsRetry, setClaimsRetry] = useState(0);
  const retryCountRef = useRef(0);
  // Store constraints in a ref — they're always the same per call site
  // and shouldn't trigger re-subscriptions on every render
  const constraintsRef = useRef(queryConstraints);
  constraintsRef.current = queryConstraints;

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setData([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let cancelRetry = null;
    const q = query(collection(db, collectionName), ...constraintsRef.current);
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        retryCountRef.current = 0;
      },
      (err) => {
        console.error(`[Firestore] ${collectionName} collection listener error:`, err.code, err.message);
        setError(err);
        setLoading(false);
        if (err.code === 'permission-denied' && retryCountRef.current < MAX_CLAIMS_RETRIES) {
          retryCountRef.current += 1;
          cancelRetry = setupClaimsRetry(() => setClaimsRetry((n) => n + 1));
        }
      }
    );

    return () => {
      unsub();
      if (cancelRetry) cancelRetry();
    };
  }, [user, authLoading, collectionName, claimsRetry]);

  return { data, loading: authLoading || loading, error };
}
