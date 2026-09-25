'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { capture, identify } from './analytics';
import { desktopHost } from './desktop-host';
import {
  API_URL,
  clearWorkspaceSession,
  endOidcSession,
  fetchAuthConfig,
  fetchOidcSession,
  loadWorkspaceSession,
  type AuthMode,
  type PublicAuthConfig,
} from './workspace-session';

interface OpenAgentsUser {
  email: string;
  displayName: string;
  photoURL: string | null;
}

interface OpenAgentsAuthContextValue {
  user: OpenAgentsUser | null;
  idToken: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  isOpenAgentsDomain: boolean;
  authMode: AuthMode;
  providerName: string;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

// `workspace` is the desktop build: the launcher serves the bundle from
// openagents://workspace/, so that is this app's own host there — the same way
// workspace.openagents.org is on the web. Without it the desktop app would
// decide it was a third-party deployment and show the marketing landing page.
const OPENAGENTS_HOSTNAMES = ['workspace.openagents.org', 'localhost', 'workspace'];

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
  const [authMode, setAuthMode] = useState<AuthMode>('workspace_token');
  const [providerName, setProviderName] = useState('Company SSO');

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const initialize = async () => {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
      const isDomain = OPENAGENTS_HOSTNAMES.includes(hostname);
      let config: PublicAuthConfig | null = null;
      try {
        config = await fetchAuthConfig();
      } catch {
        config = null;
      }
      if (cancelled) return;
      const mode = config?.mode || (isDomain ? 'firebase' : 'workspace_token');
      setAuthMode(mode);
      setProviderName(config?.oidc?.providerName || 'Company SSO');

      if (mode === 'oidc') {
        setIsOpenAgentsDomain(true);
        try {
          const session = await fetchOidcSession();
          if (!cancelled && session) {
            const label = session.email;
            setUser({ email: label, displayName: session.displayName || label, photoURL: null });
            setIdToken(null);
            identify(label, { email: label, display_name: session.displayName || label });
          }
        } catch {
          if (!cancelled) {
            setUser(null);
            setIdToken(null);
          }
        }
        if (!cancelled) setLoading(false);
        return;
      }

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

      if (desktopHost()) { setLoading(false); return; }

      // Dynamically import firebase to avoid loading it on non-openagents domains
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
      fallbackTimer = setTimeout(settle, 5000);

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

    };
    void initialize();
    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      unsubscribe?.();
    };
  }, []);

  // In the desktop app the launcher owns the session and pushes renewals here;
  // the page never decides on its own that the account has ended.
  useEffect(() => desktopHost()?.onSession?.((session) => {
    setUser({ email: session.email, displayName: session.displayName || session.email, photoURL: null });
    setIdToken(session.token);
  }), []);

  const signIn = useCallback(async () => {
    const host = desktopHost();
    if (host) { host.signIn(); return; }
    if (authMode === 'oidc') {
      window.location.assign(`${API_URL}/v1/auth/oidc/login?return_to=${encodeURIComponent(window.location.href)}`);
      return;
    }
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
  }, [authMode]);

  const signOut = useCallback(async () => {
    if (authMode === 'oidc') {
      let logoutUrl: string | null = null;
      try {
        logoutUrl = await endOidcSession();
      } catch {
        toast.error('Sign-out failed. Please try again.');
        return;
      }
      setUser(null);
      setIdToken(null);
      if (logoutUrl) window.location.assign(logoutUrl);
      return;
    }
    // Drop the workspace session first so a Firebase failure (Google
    // unreachable) can't leave the user signed in.
    clearWorkspaceSession();
    setUser(null);
    setIdToken(null);
    const host = desktopHost();
    if (host) { host.signOut(); return; }
    const { signOutUser } = await import('./firebase');
    await signOutUser();
  }, [authMode]);

  const isAuthenticated = Boolean(user && (authMode === 'oidc' || idToken));

  return (
    <OpenAgentsAuthContext.Provider value={{
      user,
      idToken,
      isAuthenticated,
      loading,
      isOpenAgentsDomain,
      authMode,
      providerName,
      signIn,
      signOut,
    }}>
      {children}
    </OpenAgentsAuthContext.Provider>
  );
}
