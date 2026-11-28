'use client';

import { readWorkspaceCookie, setWorkspaceCookie } from '@/lib/workspace-cookie';
import { WorkspaceAccessGate } from '@/components/workspace-access-gate';
import { getApiBaseUrl } from '@/lib/api-base';

import { use, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace-context';
import { LayoutProvider } from '@/components/layout/layout-context';
import { Wrapper } from '@/components/layout/wrapper';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin, redirectToLogin } from '@/lib/auth-redirects';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { useT } from '@/lib/i18n';
import { recallWorkspaceToken, rememberWorkspaceToken } from '@/lib/workspace-snapshot';

function WorkspaceLoadingSplash() {
  const t = useT();
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
          <h1 className="text-xl font-semibold tracking-tight">OpenAgents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('workspaceGate.workspace')}</p>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted overflow-hidden">
        <div className="h-full w-1/3 bg-primary rounded-full animate-[loading-bar_1.5s_ease-in-out_infinite]" />
      </div>
      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(150%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

function IdentityGate({ children }: { children: React.ReactNode }) {
  const { currentUser, setUserName } = useWorkspace();
  const t = useT();

  useEffect(() => {
    if (!currentUser.name.trim()) {
      setUserName(t('workspaceGate.guest'));
    }
  }, [currentUser.name, setUserName, t]);

  return <>{children}</>;
}

/**
 * Open a workspace by id/slug with no token in the URL: look the workspace token
 * up from the signed-in user's account (Membership Home data) and use it, plus
 * the bearer. Falls back to bearer-only if the token can't be resolved.
 */
type BearerState =
  | { kind: 'loading' }
  | { kind: 'ok'; token: string }
  | { kind: 'not_found' }
  | { kind: 'no_access' }
  | { kind: 'error' };

function BearerWorkspace({ workspaceId, idToken }: { workspaceId: string; idToken: string }) {
  const t = useT();
  // A token this page already resolved opens the workspace straight away; the
  // lookup below still runs and only replaces it if the account says otherwise.
  const [state, setState] = useState<BearerState>(() => {
    const known = recallWorkspaceToken(workspaceId, idToken);
    return known !== null ? { kind: 'ok', token: known } : { kind: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const known = recallWorkspaceToken(workspaceId, idToken);
    // A previous lookup may have left this mounted gate loading under another
    // credential. Restore the cached state as well as the cached token.
    setState(known === null ? { kind: 'loading' } : { kind: 'ok', token: known });
    (async () => {
      try {
        const { listAccountWorkspaces } = await import('@/lib/account-api');
        const wss = await listAccountWorkspaces(idToken, AbortSignal.timeout(15_000));
        if (cancelled) return;
        const match = wss.find((w) => w.slug === workspaceId || w.workspaceId === workspaceId);
        if (match) {
          // The account lookup refreshes verified profile defaults. A shell
          // restored from a cached token may already have read an older roster.
          window.dispatchEvent(new Event('workspace-profile-updated'));
          setWorkspaceCookie(match.slug || workspaceId, match.token || '');
          rememberWorkspaceToken(workspaceId, idToken, match.token || '');
          const token = match.token || '';
          setState((previous) => previous.kind === 'ok' && previous.token === token
            ? previous : { kind: 'ok', token });
          return;
        }
        // Not one of the user's workspaces. Previously we rendered the full
        // workspace shell with an empty token — every API call then failed
        // silently and a nonexistent slug looked like a working (empty)
        // workspace. Probe existence so a typo'd link and a membership gap
        // get distinct, explicit error screens instead.
        const apiUrl = getApiBaseUrl();
        const res = await fetch(`${apiUrl}/v1/workspaces/${encodeURIComponent(workspaceId)}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
        if (cancelled) return;
        setState(res.status === 404 ? { kind: 'not_found' } : { kind: 'no_access' });
      } catch {
        // Already open on a known token: a failed re-check is not worth
        // tearing the workspace down for.
        if (!cancelled && known === null) setState({ kind: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, idToken, attempt]);

  if (state.kind === 'loading') return <WorkspaceLoadingSplash />;

  if (state.kind === 'ok') {
    return (
      <WorkspaceProvider workspaceId={workspaceId} token={state.token} bearerToken={idToken}>
        <IdentityGate>
          <LayoutProvider>
            <Wrapper />
          </LayoutProvider>
        </IdentityGate>
      </WorkspaceProvider>
    );
  }

  const title =
    state.kind === 'not_found' ? t('workspaceGate.notFoundTitle')
    : state.kind === 'no_access' ? t('workspaceGate.noAccessTitle')
    : t('workspaceGate.loadFailedTitle');
  const body =
    state.kind === 'not_found' ? t('workspaceGate.notFoundBody')
    : state.kind === 'no_access' ? t('workspaceGate.noAccessBody')
    : t('workspaceGate.loadFailedBody');

  return (
    <Empty className="min-h-screen rounded-none bg-background">
      <EmptyHeader>
        <EmptyTitle className="text-xl font-semibold">{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        {state.kind === 'error' && (
          <Button variant="outline" onClick={() => setAttempt((a) => a + 1)}>
            {t('common.retry')}
          </Button>
        )}
        <Button asChild>
          <a href="/">{t('workspaceGate.goHome')}</a>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function WorkspaceContent({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const searchParams = useSearchParams();
  const urlToken = searchParams.get('token');
  const [saved, setSaved] = useState<{ slug: string; token: string } | null>(null);
  const [cookieResolved, setCookieResolved] = useState(false);
  const { user, idToken, loading: authLoading, isOpenAgentsDomain, signIn } = useOpenAgentsAuth();

  // Saved tokens are scoped to this workspace and never replace hosted identity.
  const token = urlToken || (!isOpenAgentsDomain && saved?.slug === workspaceId ? saved.token : null);
  useEffect(() => {
    if (urlToken?.trim()) setWorkspaceCookie(workspaceId, urlToken);
    setSaved(readWorkspaceCookie(workspaceId));
    setCookieResolved(true);
  }, [workspaceId, urlToken]);

  // "Add this workspace to my account": a signed-in user who opened a shared
  // ?token= link is persisted as a member so it shows on their Membership Home.
  useEffect(() => {
    if (token && idToken) {
      import('@/lib/account-api').then(({ joinWorkspaceSelf }) =>
        joinWorkspaceSelf(workspaceId, idToken, token),
      );
    }
  }, [workspaceId, token, idToken]);

  useEffect(() => {
    if (!authLoading && isOpenAgentsDomain && (!user || !idToken)) redirectToLogin();
  }, [authLoading, isOpenAgentsDomain, user, idToken]);

  // Wait for the person's identity before ever configuring a token-only client.
  if (authLoading || (!isOpenAgentsDomain && !cookieResolved) || (isOpenAgentsDomain && (!user || !idToken))) return <WorkspaceLoadingSplash />;

  // Has workspace token in URL — use it directly
  if (token) {
    return (
      <WorkspaceProvider workspaceId={workspaceId} token={token} bearerToken={idToken || undefined}>
        <IdentityGate>
          <LayoutProvider>
            <Wrapper />
          </LayoutProvider>
        </IdentityGate>
      </WorkspaceProvider>
    );
  }

  // No token — check if user is logged in via OpenAgents
  if (isOpenAgentsDomain) {
    if (authLoading) {
      return <WorkspaceLoadingSplash />;
    }

    if (user && idToken) {
      // Logged in, no ?token in the URL — resolve the workspace token from the
      // account service using the user's identity, so the URL stays clean
      // (/{slug}) while realtime (SSE, which needs a token) still works.
      return <BearerWorkspace workspaceId={workspaceId} idToken={idToken} />;
    }

    // Not logged in — show login prompt
    return (
      <Empty className="min-h-screen rounded-none bg-background">
        <EmptyHeader>
          <EmptyTitle className="text-xl font-semibold">{t('workspaceGate.signInTitle')}</EmptyTitle>
          <EmptyDescription>{t('workspaceGate.signInBody')}</EmptyDescription>
        </EmptyHeader>
        {/* Redirects to the central login page (openagents.org/login), which
            offers all supported methods — not just Google — so the label/icon
            stay method-neutral. */}
        <EmptyContent>
          <Button size="lg" onClick={() => goToCentralLogin(signIn)}>
            <LogIn data-icon="inline-start" />
            {t('workspaceGate.logIn')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return <WorkspaceAccessGate />;
}

export default function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = use(params);

  return (
    <Suspense fallback={<WorkspaceLoadingSplash />}>
      <WorkspaceContent workspaceId={workspaceId} />
    </Suspense>
  );
}
