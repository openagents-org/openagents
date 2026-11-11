'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { capture } from '@/lib/analytics';
import { isDesktopSignIn } from '@/lib/desktop-handoff';
import { autoEnterTarget, markAutoEntered, rememberWorkspaceTokens } from '@/lib/first-workspace';
import { useT, type MessageKey } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';

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
 *
 * openagents.org adds `google=unreachable` when it already knows Google's auth
 * endpoints are out of reach (a mainland-China IP, or its reachability probe
 * failed). Then the Firebase attempt could only time out, so we skip it and
 * take the server-side exchange straight away.
 *
 * Once signed in, we move on inside the already-loaded app instead of
 * reloading it, as soon as the auth context holds the new identity; and a user
 * whose only workspace is the one we auto-provisioned goes straight into it
 * rather than through the home page. If the context does not catch up in time,
 * we fall back to the full-page redirect.
 */

/** How long to give Firebase before assuming Google is unreachable. */
const FIREBASE_TIMEOUT_MS = 4000;

/** How long to wait for the auth context to pick up the new sign-in. */
const CONTEXT_TIMEOUT_MS = 3000;

/** Past this, the home page (which retries) fetches the workspace list instead. */
const LIST_TIMEOUT_MS = 5000;

/** Where to go once the auth context holds `idToken`. */
interface Handoff {
  dest: string;
  idToken: string;
}

/** A catalogue key, translated at render time, or a raw message from an Error. */
type ErrorMessage = { key: MessageKey } | { text: string };

/** Only honour a same-origin returnTo (avoid open-redirects); else home. */
function destinationOf(returnTo: string | null): string {
  if (!returnTo) return '/';
  try {
    const u = new URL(returnTo, window.location.origin);
    if (u.origin === window.location.origin) return u.pathname + u.search + u.hash;
  } catch {
    /* ignore malformed returnTo */
  }
  return '/';
}

function AuthCallback() {
  const t = useT();
  const router = useRouter();
  const { idToken, adoptWorkspaceSession } = useOpenAgentsAuth();
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const movedOnRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ct = params.get('ct');
    const returnTo = params.get('returnTo');
    const googleUnreachable = params.get('google') === 'unreachable';

    if (!ct) {
      setError({ key: 'auth.missingToken' });
      return;
    }

    (async () => {
      try {
        const [{ signInWithCustomTokenValue }, { exchangeHandoffToken, clearWorkspaceSession, loadWorkspaceSession }] =
          await Promise.all([import('@/lib/firebase'), import('@/lib/workspace-session')]);

        const dest = destinationOf(returnTo);
        if (isDesktopSignIn(returnTo)) {
          // The desktop app can only hold a workspace session, so this one is
          // not raced against Firebase — it goes straight to the exchange.
          await exchangeHandoffToken(ct);
          window.location.replace(dest);
        } else if (googleUnreachable) {
          const session = await exchangeHandoffToken(ct);
          adoptWorkspaceSession(session);
          setHandoff({ dest, idToken: session.token });
        } else {
          // A workspace session already in this browser kept the auth context
          // off Firebase at load, so it will not see a Firebase sign-in here;
          // only a reload switches it over.
          const hadSession = loadWorkspaceSession() !== null;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const firebaseTimeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('auth/network-request-failed (timeout)')),
              FIREBASE_TIMEOUT_MS,
            );
          });

          try {
            const firebaseUser = await Promise.race([signInWithCustomTokenValue(ct), firebaseTimeout]);
            // Native Firebase session established — make sure no stale
            // workspace session shadows it.
            clearWorkspaceSession();
            if (hadSession) {
              window.location.replace(dest);
            } else {
              // The cached token the context's listener will publish for this user.
              setHandoff({ dest, idToken: await firebaseUser.getIdToken() });
            }
          } catch (firebaseErr) {
            console.warn('Firebase sign-in unavailable, using workspace session:', firebaseErr);
            const session = await exchangeHandoffToken(ct);
            adoptWorkspaceSession(session);
            setHandoff({ dest, idToken: session.token });
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? { text: e.message } : { key: 'auth.signInFailedRetry' });
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Signed in: move on once the auth context holds this sign-in, else reload.
  const ready = handoff !== null && idToken === handoff.idToken;
  useEffect(() => {
    if (!handoff || ready) return;
    const timer = setTimeout(() => window.location.replace(handoff.dest), CONTEXT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [handoff, ready]);

  useEffect(() => {
    if (!handoff || !ready || movedOnRef.current) return;
    movedOnRef.current = true;
    if (handoff.dest !== '/') {
      router.replace(handoff.dest);
      return;
    }
    (async () => {
      try {
        const { listAccountWorkspaces } = await import('@/lib/account-api');
        const list = await listAccountWorkspaces(handoff.idToken, AbortSignal.timeout(LIST_TIMEOUT_MS));
        rememberWorkspaceTokens(list, handoff.idToken);
        const first = autoEnterTarget(list);
        if (first) {
          // The home page's checkpoints, since this skips the home page.
          capture('membership_home_viewed', { workspace_count: list.length, via: 'auth_callback' });
          markAutoEntered();
          capture('first_workspace_auto_entered', { workspace_id: first.slug });
          router.replace(`/${first.slug}`);
          return;
        }
      } catch {
        /* the home page fetches the list itself, with retries */
      }
      router.replace('/');
    })();
  }, [handoff, ready, router]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-background">
        <h1 className="text-xl font-semibold text-destructive">{t('auth.signInFailed')}</h1>
        <p className="text-muted-foreground text-sm text-center max-w-md">
          {'key' in error ? t(error.key) : error.text}
        </p>
        <a
          href="https://openagents.org/login"
          className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          {t('auth.backToSignIn')}
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
          <h1 className="text-xl font-semibold tracking-tight">{t('auth.signingIn')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('metadata.title')}</p>
        </div>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return <AuthCallback />;
}
