'use client';

import { use, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft, KeyRound, Lock, LogIn } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { AdminSettingsContext, canAdminister, canAccessSettingsSection, type AdminSettingsValue } from '@/components/settings/admin-context';
import { SettingsNav } from '@/components/settings/settings-nav';
import { workspaceApi } from '@/lib/api';
import type { Workspace, WorkspaceMe } from '@/lib/types';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin, redirectToLogin } from '@/lib/auth-redirects';
import { roleLabel } from '@/lib/roles';
import { useT } from '@/lib/i18n';

/** Read the workspace token persisted by the main workspace view (see
 * setWorkspaceCookie in app/[workspaceId]/page.tsx). */
function readCookieToken(workspaceId: string): string | null {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie.split('; ').find((c) => c.startsWith('oa_workspace='));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw.slice('oa_workspace='.length)));
    if (parsed?.slug === workspaceId && typeof parsed.token === 'string') return parsed.token;
  } catch { /* malformed cookie */ }
  return null;
}

/** A whole-screen message (sign in, no access, failed or still loading). */
function FullPageState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background p-8">
      <Empty>{children}</Empty>
    </div>
  );
}

function SettingsShell({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, idToken, loading: authLoading, isOpenAgentsDomain, signIn } = useOpenAgentsAuth();

  const urlToken = searchParams.get('token');
  const query = urlToken ? `?token=${encodeURIComponent(urlToken)}` : '';

  // ── Credential resolution: ?token= → oa_workspace cookie → account lookup ──
  // null = still resolving; '' = no workspace token (bearer-only or anonymous).
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (urlToken) { setToken(urlToken); return; }
    const fromCookie = readCookieToken(workspaceId);
    if (fromCookie) { setToken(fromCookie); return; }
    if (authLoading) return;
    if (idToken) {
      let cancelled = false;
      import('@/lib/account-api')
        .then(({ listAccountWorkspaces }) => listAccountWorkspaces(idToken))
        .then((wss) => {
          if (cancelled) return;
          const match = wss.find((w) => w.slug === workspaceId || w.workspaceId === workspaceId);
          setToken(match?.token || '');
        })
        .catch(() => { if (!cancelled) setToken(''); });
      return () => { cancelled = true; };
    }
    setToken('');
  }, [urlToken, workspaceId, idToken, authLoading]);

  // ── Load workspace + caller role once credentials are settled ──
  const credentialKey = `${workspaceId}:${idToken || ''}:${token ?? ''}`;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [me, setMe] = useState<WorkspaceMe | null>(null);
  const [error, setError] = useState<'denied' | 'load' | null>(null);

  useEffect(() => {
    if (token === null || authLoading || (isOpenAgentsDomain && (!user || !idToken))) return;
    workspaceApi.configure(workspaceId, token, idToken || undefined);
    let cancelled = false;
    Promise.all([workspaceApi.getWorkspace(), workspaceApi.getMe()])
      .then(([ws, meData]) => {
        if (cancelled) return;
        setLoadedFor(credentialKey);
        setWorkspace(ws);
        setMe(meData);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : '';
        setError(msg.includes('API 401') || msg.includes('API 403') ? 'denied' : 'load');
      });
    return () => { cancelled = true; };
  }, [token, workspaceId, idToken, authLoading, isOpenAgentsDomain, user, credentialKey]);

  const refreshWorkspace = useCallback(async () => {
    setWorkspace(await workspaceApi.getWorkspace());
  }, []);

  const ctxValue = useMemo<AdminSettingsValue | null>(() => {
    if (!workspace || !me || loadedFor !== credentialKey) return null;
    return { workspaceId, workspace, me, token: token || '', refreshWorkspace, query };
  }, [workspaceId, workspace, me, token, refreshWorkspace, query, loadedFor, credentialKey]);

  useEffect(() => {
    if (!authLoading && isOpenAgentsDomain && (!user || !idToken)) redirectToLogin();
  }, [authLoading, isOpenAgentsDomain, user, idToken]);
  if (authLoading || (isOpenAgentsDomain && (!user || !idToken))) return null;

  if (error === 'denied') {
    // A signed-out visitor on the hosted domain may simply need to log in.
    if (isOpenAgentsDomain && !user && !authLoading) {
      return (
        <FullPageState>
          <EmptyHeader>
            <EmptyMedia variant="icon"><LogIn /></EmptyMedia>
            <EmptyTitle>{t('workspaceGate.signInTitle')}</EmptyTitle>
            <EmptyDescription>{t('workspaceGate.signInBody')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" onClick={() => goToCentralLogin(signIn)}>
              <LogIn data-icon="inline-start" />
              {t('workspaceGate.logIn')}
            </Button>
          </EmptyContent>
        </FullPageState>
      );
    }
    return (
      <FullPageState>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Lock /></EmptyMedia>
          <EmptyTitle>{t('admin.accessDeniedTitle')}</EmptyTitle>
          <EmptyDescription>{t('admin.accessDeniedBody')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" asChild>
            <Link href={`/${workspaceId}${query}`}>{t('admin.backToWorkspace')}</Link>
          </Button>
        </EmptyContent>
      </FullPageState>
    );
  }

  if (error === 'load') {
    return (
      <FullPageState>
        <EmptyHeader>
          <EmptyDescription>{t('admin.loadFailed')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t('admin.retry')}
          </Button>
        </EmptyContent>
      </FullPageState>
    );
  }

  if (!ctxValue) {
    return (
      <FullPageState>
        <Spinner className="size-5 text-muted-foreground" aria-label={t('admin.loading')} />
      </FullPageState>
    );
  }

  const section = pathname?.split('/settings/')[1]?.split('/')[0] || '';
  const sectionAllowed = !section || canAccessSettingsSection(ctxValue.me, section);
  const roleBadge = ctxValue.me.role
    ? roleLabel(t, ctxValue.me.role)
    : ctxValue.me.tokenAccess
      ? t('admin.roleBadgeToken')
      : roleLabel(t, ctxValue.me.effectiveRole);

  return (
    <AdminSettingsContext.Provider value={ctxValue}>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href={`/${workspaceId}${query}`} aria-label={t('admin.backToWorkspace')}>
                <ArrowLeft data-icon="inline-start" />
                <span className="hidden sm:inline">{t('admin.backToWorkspace')}</span>
              </Link>
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-semibold">
                {ctxValue.workspace.name}
                <span className="ms-2 font-normal text-muted-foreground">· {canAdminister(ctxValue.me) ? t('admin.title') : t('userMenu.personalSettings')}</span>
              </h1>
            </div>
            {roleBadge && (
              <Badge variant="secondary">
                <KeyRound data-icon="inline-start" />
                {roleBadge}
              </Badge>
            )}
          </div>
        </header>

        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:flex-row md:gap-10">
          <SettingsNav workspaceId={workspaceId} me={ctxValue.me} pathname={pathname} query={query} />
          <main className="min-w-0 flex-1 pb-16">{sectionAllowed ? children : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Lock /></EmptyMedia>
                <EmptyTitle>{t('admin.accessDeniedTitle')}</EmptyTitle>
                <EmptyDescription>{t('admin.adminRequired')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" asChild><Link href={`/${workspaceId}/settings/profile${query}`}>{t('userMenu.personalSettings')}</Link></Button>
              </EmptyContent>
            </Empty>
          )}</main>
        </div>
      </div>
    </AdminSettingsContext.Provider>
  );
}

export default function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = use(params);
  return (
    <Suspense
      fallback={
        <FullPageState>
          <Spinner className="size-5 text-muted-foreground" />
        </FullPageState>
      }
    >
      <SettingsShell workspaceId={workspaceId}>{children}</SettingsShell>
    </Suspense>
  );
}
