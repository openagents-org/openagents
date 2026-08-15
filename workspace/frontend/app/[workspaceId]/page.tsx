'use client';

import { use, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace-context';
import { LayoutProvider } from '@/components/layout/layout-context';
import { Wrapper } from '@/components/layout/wrapper';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { LogIn } from 'lucide-react';
import { useT } from '@/lib/i18n';

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

function setWorkspaceCookie(slug: string, token: string) {
  const maxAge = 30 * 24 * 60 * 60;
  const shared = `path=/;max-age=${maxAge};secure;samesite=lax;domain=.openagents.org`;
  document.cookie = `oa_workspace=${encodeURIComponent(JSON.stringify({ slug, token }))};${shared}`;
  document.cookie = `oa_has_workspace=1;${shared}`;
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
function BearerWorkspace({ workspaceId, idToken }: { workspaceId: string; idToken: string }) {
  const [resolvedToken, setResolvedToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('@/lib/account-api')
      .then(({ listAccountWorkspaces }) => listAccountWorkspaces(idToken))
      .then((wss) => {
        if (cancelled) return;
        const match = wss.find((w) => w.slug === workspaceId || w.workspaceId === workspaceId);
        const tok = match?.token || '';
        if (tok) setWorkspaceCookie(match!.slug || workspaceId, tok);
        setResolvedToken(tok);
      })
      .catch(() => { if (!cancelled) setResolvedToken(''); });
    return () => { cancelled = true; };
  }, [workspaceId, idToken]);

  if (resolvedToken === null) return <WorkspaceLoadingSplash />;

  return (
    <WorkspaceProvider workspaceId={workspaceId} token={resolvedToken} bearerToken={idToken}>
      <IdentityGate>
        <LayoutProvider>
          <Wrapper />
        </LayoutProvider>
      </IdentityGate>
    </WorkspaceProvider>
  );
}

function WorkspaceContent({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { user, idToken, loading: authLoading, isOpenAgentsDomain, signIn } = useOpenAgentsAuth();

  useEffect(() => {
    if (token) {
      setWorkspaceCookie(workspaceId, token);
    }
  }, [workspaceId, token]);

  // "Add this workspace to my account": a signed-in user who opened a shared
  // ?token= link is persisted as a member so it shows on their Membership Home.
  useEffect(() => {
    if (token && idToken) {
      import('@/lib/account-api').then(({ joinWorkspaceSelf }) =>
        joinWorkspaceSelf(workspaceId, idToken, token),
      );
    }
  }, [workspaceId, token, idToken]);

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
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 bg-background">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-xl font-semibold">{t('workspaceGate.signInTitle')}</h1>
          <p className="text-muted-foreground text-sm text-center max-w-md">
            {t('workspaceGate.signInBody')}
          </p>
        </div>
        {/* Redirects to the central login page (openagents.org/login), which
            offers all supported methods — not just Google — so the label/icon
            stay method-neutral. */}
        <button
          onClick={() => goToCentralLogin(signIn)}
          className="flex items-center gap-3 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <LogIn className="size-5" />
          {t('workspaceGate.logIn')}
        </button>
      </div>
    );
  }

  // Not on OpenAgents domain and no token — show token instructions
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-background">
      <h1 className="text-xl font-semibold text-destructive">{t('workspaceGate.missingToken')}</h1>
      <p className="text-muted-foreground text-sm">
        {t('workspaceGate.missingTokenBefore')}{' '}
        <code className="bg-muted px-2 py-0.5 rounded">?token=your_workspace_token</code>{' '}
        {t('workspaceGate.missingTokenAfter')}
      </p>
    </div>
  );
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
