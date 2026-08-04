import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCXgN-7HfgAQiN0pRKqGi8jMbGGo9e9X34',
  authDomain: 'openagentsweb.firebaseapp.com',
  projectId: 'openagentsweb',
  storageBucket: 'openagentsweb.firebasestorage.app',
  messagingSenderId: '796726902048',
  appId: '1:796726902048:web:5b9079c5b2c3061edc2b45',
  measurementId: 'G-1QYBRXC8RK',
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/**
 * Sign in with a Firebase custom token minted by the openagents.org backend
 * (POST /v1/auth/workspace-handoff). Establishes a native, self-refreshing
 * Firebase session on this origin — the workspace app can't inherit the
 * openagents.org session because Firebase persists auth per-origin.
 */
export async function signInWithCustomTokenValue(customToken: string) {
  const result = await signInWithCustomToken(auth, customToken);
  return result.user;
}

export async function signOutUser() {
  await signOut(auth);
}

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(true);
}

/**
 * Resolve the user's email. Real Firebase accounts (Google/GitHub) expose it as
 * `user.email`; users signed in via a custom token (the email/password handoff)
 * carry it only as an `email` custom claim on the ID token, so fall back to that.
 */
export async function getResolvedEmail(): Promise<string> {
  const user = auth.currentUser;
  if (!user) return '';
  if (user.email) return user.email;
  try {
    const res = await user.getIdTokenResult();
    return (res.claims.email as string) || '';
  } catch {
    return '';
  }
}

export { auth };
