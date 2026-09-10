'use client';

import { useEffect, useState } from 'react';

import { isDesktopSignIn } from '@/lib/desktop-handoff';

/**
 * Login handoff landing page.
 *
 * openagents.org logs the user in, mints a one-time Firebase custom token, and
 * redirects here (workspace.openagents.org/auth/callback?ct=...&returnTo=...).
 * We exchange the custom token for a native Firebase session on THIS origin via
 * signInWithCustomToken, then forward to the intended destination. Firebase
 * persists auth per-origin, so this is what carries the login across subdomains.
 *
 * Where the browser cannot reach Google (mainland China), signInWithCustomToken
 * fails with auth/network-request-failed or just hangs. In that case we hand
 * the same custom token to our backend, which does the exchange server-side
 * and returns a workspace session JWT (see lib/workspace-session.ts).
 *
 * A sign-in belonging to the desktop launcher takes that server-side exchange
 * FIRST, wherever Google stands. The app has to KEEP the credential, and a
 * Firebase session cannot leave the page: its ID token lapses in an hour and
 * its refresh token is not ours to hand over. Everything else about the flow
 * is unchanged — same login, same callback, same destination. See
 * lib/desktop-handoff.ts.
 */

/** How long to give Firebase before assuming Google is unreachable. */
const FIREBASE_TIMEOUT_MS = 4000;

function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ct = params.get('ct');
    const returnTo = params.get('returnTo');

    if (!ct) {
      setError('Missing sign-in token. Please try signing in again.');
      return;
    }

    (async () => {
      try {
        const [{ signInWithCustomTokenValue }, { exchangeHandoffToken, clearWorkspaceSession }] =
          await Promise.all([import('@/lib/firebase'), import('@/lib/workspace-session')]);

        if (isDesktopSignIn(returnTo)) {
          // The desktop app can only hold a workspace session, so this one is
          // not raced against Firebase — it goes straight to the exchange.
          await exchangeHandoffToken(ct);
        } else {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const firebaseTimeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('auth/network-request-failed (timeout)')),
              FIREBASE_TIMEOUT_MS,
            );
          });

          try {
            await Promise.race([signInWithCustomTokenValue(ct), firebaseTimeout]);
            // Native Firebase session established — make sure no stale
            // workspace session shadows it.
            clearWorkspaceSession();
          } catch (firebaseErr) {
            console.warn('Firebase sign-in unavailable, using workspace session:', firebaseErr);
            await exchangeHandoffToken(ct);
          } finally {
            if (timer) clearTimeout(timer);
          }
        }

        // Only honour a same-origin returnTo (avoid open-redirects); else home.
        let dest = '/';
        if (returnTo) {
          try {
            const u = new URL(returnTo, window.location.origin);
            if (u.origin === window.location.origin) {
              dest = u.pathname + u.search + u.hash;
            }
          } catch {
            /* ignore malformed returnTo */
          }
        }
        window.location.replace(dest);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-background">
        <h1 className="text-xl font-semibold text-destructive">Sign-in failed</h1>
        <p className="text-muted-foreground text-sm text-center max-w-md">{error}</p>
        <a
          href="https://openagents.org/login"
          className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <img
          src="/logo-icon.png"
          alt="OpenAgents"
          className="size-16 animate-[pulse_2s_ease-in-out_infinite] dark:hidden"
        />
        <img
          src="/logo-white.png"
          alt="OpenAgents"
          className="size-16 animate-[pulse_2s_ease-in-out_infinite] hidden dark:block"
        />
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">Signing you in…</h1>
          <p className="text-sm text-muted-foreground mt-0.5">OpenAgents Workspace</p>
        </div>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return <AuthCallback />;
}
