'use client';

import { useEffect, useState } from 'react';

import {
  DESKTOP_AUTH_PATH,
  forwardToDesktop,
  parseDesktopHandoff,
  type DesktopHandoff,
} from '@/lib/desktop-handoff';
import { useT, type MessageKey } from '@/lib/i18n';
import { loadWorkspaceSession } from '@/lib/workspace-session';

/**
 * The desktop launcher's sign-in landing.
 *
 * The launcher opens this page with the loopback port it is listening on. From
 * here there are exactly two outcomes:
 *
 *  - a workspace session already exists on this origin → hand it to the port
 *  - none does → send the user through the central login, with this page as
 *    the returnTo, and take the first branch when they come back
 *
 * Deliberately an ordinary page rather than a branch of /auth/callback: the
 * central login mints its one-time token and bounces through the callback ON
 * THE WAY to returnTo, so a returnTo pointing at the callback is treated as the
 * final destination and no token is ever minted. Being a normal destination
 * keeps this on the same path every browser sign-in already takes.
 */

const CENTRAL = 'https://openagents.org';

/** Set once we have been through the login; a second empty return is a failure,
 *  not a reason to bounce again. */
const RETRY_FLAG = 'retried';

type Phase = 'working' | 'done' | 'failed';

/** A catalogue key, translated at render time, or a raw message from an Error. */
type ErrorMessage = { key: MessageKey } | { text: string };

function DesktopAuth() {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('working');
  const [error, setError] = useState<ErrorMessage | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const handoff = parseDesktopHandoff(window.location.search);
    if (!handoff) {
      setPhase('failed');
      setError({ key: 'auth.desktopLinkInvalid' });
      return;
    }

    const session = loadWorkspaceSession();
    if (!session) {
      if (params.get(RETRY_FLAG)) {
        setPhase('failed');
        setError({ key: 'auth.desktopNoSession' });
        return;
      }
      window.location.replace(`${CENTRAL}/login?returnTo=${encodeURIComponent(returnUrl(handoff))}`);
      return;
    }

    void (async () => {
      try {
        await forwardToDesktop(handoff, {
          session: {
            token: session.token,
            email: session.email,
            displayName: session.displayName,
            expiresAt: session.expiresAt,
          },
        });
        setPhase('done');
      } catch (e) {
        setPhase('failed');
        setError(e instanceof Error ? { text: e.message } : { key: 'auth.desktopUnreachable' });
      }
    })();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <img
          src="/logo-icon.png"
          alt="OpenAgents"
          className={`size-16 dark:hidden ${phase === 'working' ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''}`}
        />
        <img
          src="/logo-white.png"
          alt="OpenAgents"
          className={`size-16 hidden dark:block ${phase === 'working' ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''}`}
        />
        <div className="text-center max-w-md px-8">
          <h1
            className={`text-xl font-semibold tracking-tight ${phase === 'failed' ? 'text-destructive' : ''}`}
          >
            {phase === 'done'
              ? t('auth.signedIn')
              : phase === 'failed'
                ? t('auth.signInFailed')
                : t('auth.signingIn')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {phase === 'done'
              ? t('auth.desktopReturn')
              : error
                ? ('key' in error ? t(error.key) : error.text)
                : t('metadata.title')}
          </p>
        </div>
      </div>
    </div>
  );
}

/** This page's own URL, marked so a fruitless round trip cannot loop. */
function returnUrl(handoff: DesktopHandoff): string {
  const url = new URL(DESKTOP_AUTH_PATH, window.location.origin);
  url.searchParams.set('port', String(handoff.port));
  url.searchParams.set('state', handoff.state);
  url.searchParams.set(RETRY_FLAG, '1');
  return url.href;
}

export default function DesktopAuthPage() {
  return <DesktopAuth />;
}
