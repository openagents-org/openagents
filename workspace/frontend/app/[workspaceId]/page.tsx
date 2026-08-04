'use client';

import { use, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkspaceProvider, useWorkspace } from '@/lib/workspace-context';
import { LayoutProvider } from '@/components/layout/layout-context';
import { Wrapper } from '@/components/layout/wrapper';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
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
      // User is logged in — try to access workspace via bearer token
      return (
        <WorkspaceProvider workspaceId={workspaceId} token="" bearerToken={idToken}>
          <IdentityGate>
            <LayoutProvider>
              <Wrapper />
            </LayoutProvider>
          </IdentityGate>
        </WorkspaceProvider>
      );
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
        <button
          onClick={signIn}
          className="flex items-center gap-3 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          <svg className="size-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {t('workspaceGate.signInWithGoogle')}
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
