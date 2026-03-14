'use client';

import { useState, useEffect, useRef } from 'react';
import { doc, collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import useAuth from '@/hooks/useAuth';

export function useDocument(collectionName, docId) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (authLoading) return;

    if (!user || !docId) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      doc(db, collectionName, docId),
      (snapshot) => {
        setData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        setLoading(false);
      },
      (err) => {
        console.error(`[Firestore] ${collectionName}/${docId} listener error:`, err.code, err.message);
        setError(err);
        setLoading(false);
      }
    );

    return unsub;
  }, [user, authLoading, collectionName, docId]);

  return { data, loading: authLoading || loading, error };
}

export function useCollection(collectionName, queryConstraints = []) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
    const q = query(collection(db, collectionName), ...constraintsRef.current);
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setData(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error(`[Firestore] ${collectionName} collection listener error:`, err.code, err.message);
        setError(err);
        setLoading(false);
      }
    );

    return unsub;
  }, [user, authLoading, collectionName]);

  return { data, loading: authLoading || loading, error };
}
