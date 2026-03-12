'use client';

import { useState, useEffect, useContext, createContext } from 'react';
import {
  onAuthStateChanged,
  PhoneAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

const AuthContext = createContext(null);

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);

        // Fetch role from Firestore users doc
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setRole(userData.role || null);

            // Flip status from pending to active on first login
            if (userData.status === 'pending') {
              await updateDoc(doc(db, 'users', firebaseUser.uid), {
                status: 'active',
              });
            }
          } else if (firebaseUser.email === ADMIN_EMAIL) {
            // Fallback: no Firestore doc but email matches admin
            setRole('admin');
          } else {
            setRole(null);
          }
        } catch {
          // Fallback on Firestore error
          if (firebaseUser.email === ADMIN_EMAIL) {
            setRole('admin');
          } else {
            setRole(null);
          }
        }
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function signInWithPhone(verificationId, code) {
    const credential = PhoneAuthProvider.credential(verificationId, code);
    const result = await signInWithCredential(auth, credential);
    return result;
  }

  async function signInAdmin(email, password) {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result;
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  const isAdmin = role === 'admin';
  const isStaff = !!role;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        role,
        isAdmin,
        isStaff,
        signInWithPhone,
        signInAdmin,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export default function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
