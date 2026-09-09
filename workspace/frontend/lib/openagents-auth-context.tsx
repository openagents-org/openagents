'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { capture, identify } from './analytics';
import { clearWorkspaceSession, loadWorkspaceSession } from './workspace-session';

interface OpenAgentsUser {
  email: string;
  displayName: string;
  photoURL: string | null;
}

interface OpenAgentsAuthContextValue {
  user: OpenAgentsUser | null;
  idToken: string | null;
  loading: boolean;
  isOpenAgentsDomain: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const OPENAGENTS_HOSTNAMES = ['workspace.openagents.org', 'localhost'];

const OpenAgentsAuthContext = createContext<OpenAgentsAuthContextValue | null>(null);

export function useOpenAgentsAuth() {
  const ctx = useContext(OpenAgentsAuthContext);
  if (!ctx) throw new Error('useOpenAgentsAuth must be used within OpenAgentsAuthProvider');
  return ctx;
}

export function OpenAgentsAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<OpenAgentsUser | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOpenAgentsDomain, setIsOpenAgentsDomain] = useState(false);

  useEffect(() => {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const isDomain = OPENAGENTS_HOSTNAMES.includes(hostname);
    setIsOpenAgentsDomain(isDomain);

    if (!isDomain) {
      setLoading(false);
      return;
    }

    // A workspace-issued session (the Google-free path, see lib/workspace-session)
    // is authoritative on its own: restore it immediately, without waiting on
    // — or being overridden by — Firebase, which may be unreachable.
    const stored = loadWorkspaceSession();
    if (stored) {
      setUser({
        email: stored.email,
        displayName: stored.displayName || stored.email,
        photoURL: null,
      });
      setIdToken(stored.token);
      identify(stored.email, { email: stored.email, display_name: stored.displayName || stored.email });
      setLoading(false);
      return;
    }

    // Dynamically import firebase to avoid loading it on non-openagents domains
    let unsubscribe: (() => void) | undefined;

    // Firebase's initial auth-state resolution needs Google; where that is
    // blocked, onAuthStateChanged never fires. Resolve to "signed out" after a
    // short wait so the gate offers the sign-in button instead of spinning
    // forever. The real listener still wins whenever it fires first.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      setLoading(false);
    };
    const fallbackTimer = setTimeout(settle, 5000);

    import('./firebase').then(({ onAuthChange, getIdToken, getResolvedEmail }) => {
      unsubscribe = onAuthChange(async (firebaseUser) => {
        if (firebaseUser) {
          const token = await getIdToken();
          // Email/password users arrive via a custom token whose email lives in
          // a custom claim, not firebaseUser.email — resolve both.
          const email = firebaseUser.email || (await getResolvedEmail());
          setUser({
            email,
            displayName: firebaseUser.displayName || email,
            photoURL: firebaseUser.photoURL,
          });
          setIdToken(token);
          // Email is the cross-surface person key: identify on every auth
          // restore so handoff logins (openagents.org → /auth/callback) are
          // attributed to the same person as their website activity. identify()
          // is idempotent; the sign_in checkpoint is deduped per browser
          // session so restores don't inflate the funnel.
          if (email) {
            identify(email, { email, display_name: firebaseUser.displayName || email });
            if (!sessionStorage.getItem('oa_sign_in_tracked')) {
              sessionStorage.setItem('oa_sign_in_tracked', '1');
              const method =
                firebaseUser.providerData[0]?.providerId?.replace('.com', '') || 'handoff';
              capture('sign_in', { method });
            }
          }
        } else {
          setUser(null);
          setIdToken(null);
        }
        settle();
      });
    });

    return () => {
      clearTimeout(fallbackTimer);
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async () => {
    const { signInWithGoogle, getIdToken } = await import('./firebase');
    const firebaseUser = await signInWithGoogle();
    const token = await getIdToken();
    const email = firebaseUser.email || '';
    setUser({
      email,
      displayName: firebaseUser.displayName || email,
      photoURL: firebaseUser.photoURL,
    });
    setIdToken(token);
    // identify + sign_in are captured by the onAuthChange listener above,
    // which this popup sign-in also triggers.
  }, []);

  const signOut = useCallback(async () => {
    // Drop the workspace session first so a Firebase failure (Google
    // unreachable) can't leave the user signed in.
    clearWorkspaceSession();
    setUser(null);
    setIdToken(null);
    const { signOutUser } = await import('./firebase');
    await signOutUser();
  }, []);

  return (
    <OpenAgentsAuthContext.Provider value={{ user, idToken, loading, isOpenAgentsDomain, signIn, signOut }}>
      {children}
    </OpenAgentsAuthContext.Provider>
  );
}
