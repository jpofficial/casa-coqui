'use client';

import { useState, useEffect, useContext, createContext } from 'react';
import {
  onAuthStateChanged,
  PhoneAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

const AuthContext = createContext(null);

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  /**
   * Signs a guest in using the Firebase phone auth credential.
   * Call this after receiving a verificationId from RecaptchaVerifier +
   * signInWithPhoneNumber, along with the 6-digit code the guest entered.
   *
   * @param {string} verificationId - From Firebase signInWithPhoneNumber
   * @param {string} code           - SMS code entered by the guest
   */
  async function signInWithPhone(verificationId, code) {
    const credential = PhoneAuthProvider.credential(verificationId, code);
    const result = await signInWithCredential(auth, credential);
    return result;
  }

  /**
   * Signs the admin in with email and password.
   *
   * @param {string} email
   * @param {string} password
   */
  async function signInAdmin(email, password) {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result;
  }

  /**
   * Signs the current user out.
   */
  async function signOut() {
    await firebaseSignOut(auth);
  }

  /**
   * True when the signed-in user is the admin.
   * Checks against NEXT_PUBLIC_ADMIN_EMAIL or a custom claim if available.
   */
  const isAdmin =
    !!user &&
    (user.email === ADMIN_EMAIL ||
      user?.reloadUserInfo?.customAttributes?.includes('"admin":true'));

  return (
    <AuthContext.Provider
      value={{ user, loading, isAdmin, signInWithPhone, signInAdmin, signOut }}
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
