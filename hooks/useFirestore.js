'use client';

import { useState, useEffect, useRef } from 'react';
import { doc, collection, onSnapshot, query } from 'firebase/firestore';
import { onIdTokenChanged } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';

const MAX_CLAIMS_RETRIES = 2;

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

    let unsubTokenChange = null;
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
        // Re-subscribe on next token change if claims were not yet set when we
        // first subscribed (typical for anonymous guest sessions where custom
        // claims are set asynchronously by /api/guests/validate-token).
        if (err.code === 'permission-denied' && retryCountRef.current < MAX_CLAIMS_RETRIES) {
          retryCountRef.current += 1;
          unsubTokenChange = onIdTokenChanged(auth, (u) => {
            if (!u) return;
            if (unsubTokenChange) { unsubTokenChange(); unsubTokenChange = null; }
            setClaimsRetry((n) => n + 1);
          });
        }
      }
    );

    return () => {
      unsub();
      if (unsubTokenChange) unsubTokenChange();
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

    let unsubTokenChange = null;
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
          unsubTokenChange = onIdTokenChanged(auth, (u) => {
            if (!u) return;
            if (unsubTokenChange) { unsubTokenChange(); unsubTokenChange = null; }
            setClaimsRetry((n) => n + 1);
          });
        }
      }
    );

    return () => {
      unsub();
      if (unsubTokenChange) unsubTokenChange();
    };
  }, [user, authLoading, collectionName, claimsRetry]);

  return { data, loading: authLoading || loading, error };
}
