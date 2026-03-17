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
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [displayName, setDisplayName] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        // Force-refresh token to pick up latest custom claims (e.g. role)
        // so Firestore security rules see the correct token.role
        try {
          await firebaseUser.getIdToken(true);
        } catch (err) {
          console.warn('[useAuth] Token refresh failed:', err.code, err.message);
        }

        setUser(firebaseUser);

        // Set session cookie for middleware route protection
        document.cookie = 'casa-coqui-session=1; path=/; max-age=604800; SameSite=Lax';

        // Fetch role from Firestore users doc
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            // Use doc role, or fall back to admin email check, then token claims
            const docRole = userData.role || null;
            if (docRole) {
              setRole(docRole);
            } else if (firebaseUser.email === ADMIN_EMAIL) {
              setRole('admin');
            } else {
              // Last resort: check token claims
              const tokenResult = await firebaseUser.getIdTokenResult();
              setRole(tokenResult.claims.role || null);
            }
            setDisplayName(userData.displayName || firebaseUser.displayName || null);

            // Detect first-time login needing onboarding
            if (userData.onboardingComplete === false) {
              setNeedsOnboarding(true);
            } else {
              setNeedsOnboarding(false);
            }

            // Flip status from pending to active on first login (best-effort)
            if (userData.status === 'pending') {
              updateDoc(doc(db, 'users', firebaseUser.uid), {
                status: 'active',
              }).catch(() => {});
            }
          } else if (firebaseUser.email === ADMIN_EMAIL) {
            // Fallback: no Firestore doc but email matches admin
            setRole('admin');
          } else {
            // No Firestore doc — try custom claims from token as fallback
            const tokenResult = await firebaseUser.getIdTokenResult();
            setRole(tokenResult.claims.role || null);
          }
        } catch (err) {
          console.error('[useAuth] Failed to fetch user doc:', err.code, err.message);
          // Fallback: try custom claims from token
          try {
            const tokenResult = await firebaseUser.getIdTokenResult(true);
            if (tokenResult.claims.role) {
              setRole(tokenResult.claims.role);
            } else if (firebaseUser.email === ADMIN_EMAIL) {
              setRole('admin');
            } else {
              setRole(null);
            }
          } catch {
            if (firebaseUser.email === ADMIN_EMAIL) {
              setRole('admin');
            } else {
              setRole(null);
            }
          }
        }
      } else {
        setUser(null);
        setRole(null);
        setNeedsOnboarding(false);
        setDisplayName(null);
        // Clear session cookie
        document.cookie = 'casa-coqui-session=; path=/; max-age=0';
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
    document.cookie = 'casa-coqui-session=; path=/; max-age=0';
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
        needsOnboarding,
        setNeedsOnboarding,
        displayName,
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
