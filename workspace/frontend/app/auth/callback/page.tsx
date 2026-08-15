'use client';

import { useEffect, useState } from 'react';

/**
 * Login handoff landing page.
 *
 * openagents.org logs the user in, mints a one-time Firebase custom token, and
 * redirects here (workspace.openagents.org/auth/callback?ct=...&returnTo=...).
 * We exchange the custom token for a native Firebase session on THIS origin via
 * signInWithCustomToken, then forward to the intended destination. Firebase
 * persists auth per-origin, so this is what carries the login across subdomains.
 */
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
        const { signInWithCustomTokenValue } = await import('@/lib/firebase');
        await signInWithCustomTokenValue(ct);

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
