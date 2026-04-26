'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { ArrowRight, ArrowLeft, Link2, Clock, ChevronDown, ChevronRight, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ElectronDragBar } from '@/components/layout/electron-init';
import type { WorkspaceHistoryEntry } from '@/components/layout/electron-init';
import { WorkspaceProvider } from '@/lib/workspace-context';
import { LayoutProvider } from '@/components/layout/layout-context';
import { Wrapper } from '@/components/layout/wrapper';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';

const CANONICAL_FRONTEND = 'https://workspace.openagents.org';

/**
 * Derive the API endpoint from a frontend origin using the {name}-endpoint
 * convention. Only the first hostname label is rewritten; the rest of the
 * domain and port are preserved.
 *
 *   workspace.openagents.org  →  workspace-endpoint.openagents.org
 *   agents.caremojo.app       →  agents-endpoint.caremojo.app
 *   localhost:3000            →  localhost:3000 (untouched, no dot)
 *
 * Setups that follow a different convention (e.g. agents-api.X) need the user
 * to override via the Advanced section in the connect form.
 */
function deriveApiEndpoint(origin: string): string {
  try {
    const url = new URL(origin);
    const hostParts = url.hostname.split('.');
    if (hostParts.length >= 2) {
      hostParts[0] = `${hostParts[0]}-endpoint`;
      const port = url.port ? `:${url.port}` : '';
      return `${url.protocol}//${hostParts.join('.')}${port}`;
    }
  } catch {
    // fall through
  }
  return origin;
}

/**
 * Parse a workspace URL into id + token + auto-derived API endpoint.
 *
 *   https://workspace.openagents.org/0048fff6?token=abc  → endpoint = workspace-endpoint.openagents.org
 *   https://agents.caremojo.app/0048fff6?token=abc       → endpoint = agents-endpoint.caremojo.app
 *   /0048fff6?token=abc                                  → endpoint = workspace-endpoint.openagents.org (relative resolves to canonical)
 *   0048fff6                                             → endpoint undefined
 */
function parseWorkspaceUrl(input: string): { workspaceId: string; workspaceToken: string; endpoint?: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed, CANONICAL_FRONTEND);
    const segments = url.pathname.split('/').filter(Boolean);
    const workspaceId = segments[segments.length - 1];
    const workspaceToken = url.searchParams.get('token') || '';
    if (workspaceId) {
      const endpoint = url.origin ? deriveApiEndpoint(url.origin) : undefined;
      return { workspaceId, workspaceToken, endpoint };
    }
  } catch {
    // Not a URL — treat as bare workspace ID
  }

  if (/^[\w-]+$/.test(trimmed)) {
    return { workspaceId: trimmed, workspaceToken: '' };
  }

  return null;
}

function navigateToWorkspace(workspaceId: string, workspaceToken: string, endpoint?: string) {
  const params = new URLSearchParams();
  params.set('token', workspaceToken);
  if (endpoint) params.set('endpoint', endpoint);
  window.location.href = `/${workspaceId}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Workspace View — renders when URL path has a workspace ID
// ---------------------------------------------------------------------------

function WorkspaceView({ workspaceId, token, endpoint }: { workspaceId: string; token: string; endpoint?: string }) {
  const { user, idToken, loading: authLoading, isOpenAgentsDomain, signIn } = useOpenAgentsAuth();

  if (token) {
    return (
      <WorkspaceProvider workspaceId={workspaceId} token={token} bearerToken={idToken || undefined} endpoint={endpoint}>
        <LayoutProvider>
          <Wrapper />
        </LayoutProvider>
      </WorkspaceProvider>
    );
  }

  if (isOpenAgentsDomain) {
    if (authLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    if (user && idToken) {
      return (
        <WorkspaceProvider workspaceId={workspaceId} token="" bearerToken={idToken} endpoint={endpoint}>
          <LayoutProvider>
            <Wrapper />
          </LayoutProvider>
        </WorkspaceProvider>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8 bg-background">
        <h1 className="text-xl font-semibold">Sign in to access this workspace</h1>
        <button
          onClick={signIn}
          className="flex items-center gap-3 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-background">
      <h1 className="text-xl font-semibold text-destructive">Missing Token</h1>
      <p className="text-muted-foreground text-sm">
        Add <code className="bg-muted px-2 py-0.5 rounded">?token=your_workspace_token</code> to the URL.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selector View — renders at root path
// ---------------------------------------------------------------------------

function SelectorView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isSwitching = searchParams.get('switch') === '1';

  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [history, setHistory] = useState<WorkspaceHistoryEntry[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<{ id: string; token: string; endpoint?: string } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [apiUrlOverride, setApiUrlOverride] = useState('');
  const apiUrlEditedRef = useRef(false);

  // Auto-fill the Advanced API URL field from the pasted URL using the
  // <name>-endpoint convention, until the user manually edits it.
  const derivedApiUrl = (() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return '';
    try {
      const url = new URL(trimmed, CANONICAL_FRONTEND);
      return url.origin ? deriveApiEndpoint(url.origin) : '';
    } catch {
      return '';
    }
  })();
  useEffect(() => {
    if (!apiUrlEditedRef.current) {
      setApiUrlOverride(derivedApiUrl);
    }
  }, [derivedApiUrl]);

  useEffect(() => {
    async function init() {
      if (window.electronAPI) {
        const settings = await window.electronAPI.settings.load();
        setHistory(settings.workspaceHistory || []);

        if (isSwitching) {
          if (settings.workspaceId && settings.workspaceToken) {
            setCurrentWorkspace({ id: settings.workspaceId, token: settings.workspaceToken, endpoint: settings.workspaceEndpoint });
          }
          setLoading(false);
          return;
        }

        if (settings.workspaceId && settings.workspaceToken) {
          navigateToWorkspace(settings.workspaceId, settings.workspaceToken, settings.workspaceEndpoint);
          return;
        }
      }

      if (!isSwitching) {
        const envId = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_ID;
        const envToken = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_TOKEN;
        if (envId && envToken) {
          navigateToWorkspace(envId, envToken);
          return;
        }
      }

      setLoading(false);
    }
    init();
  }, [router, isSwitching]);

  const connectToWorkspace = async (workspaceId: string, workspaceToken: string, endpoint?: string) => {
    if (window.electronAPI) {
      await window.electronAPI.settings.save({ workspaceId, workspaceToken, workspaceEndpoint: endpoint });
    }
    navigateToWorkspace(workspaceId, workspaceToken, endpoint);
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const parsed = parseWorkspaceUrl(urlInput);
    if (!parsed || !parsed.workspaceId) {
      setError('Please enter a valid workspace URL or ID.');
      return;
    }
    if (!parsed.workspaceToken) {
      setError('URL must include a token parameter (e.g. ?token=...).');
      return;
    }

    const endpoint = apiUrlOverride.trim() || parsed.endpoint;
    await connectToWorkspace(parsed.workspaceId, parsed.workspaceToken, endpoint);
  };

  const handleCancel = () => {
    if (currentWorkspace) {
      navigateToWorkspace(currentWorkspace.id, currentWorkspace.token, currentWorkspace.endpoint);
    }
  };

  if (loading) {
    return (
      <>
        <ElectronDragBar />
        <div className="loading-screen">Loading...</div>
      </>
    );
  }

  const recentHistory = history.slice(0, 3);

  return (
    <>
      <ElectronDragBar />
      <div className="flex items-center justify-center min-h-screen bg-background p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center gap-3">
            <Image src="/app-icon.png" alt="OpenAgents" width={64} height={64} className="rounded-xl" />
            <h1 className="text-xl font-semibold">OpenAgents Workspace</h1>
            <p className="text-sm text-muted-foreground text-center">
              {isSwitching ? 'Select a workspace or paste a new URL.' : 'Paste your workspace URL to get started.'}
            </p>
          </div>

          {recentHistory.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Workspaces</p>
              <div className="flex flex-wrap gap-2">
                {recentHistory.map((entry) => {
                  const displayName = entry.name && entry.name !== entry.workspaceId
                    ? entry.name
                    : entry.workspaceId.slice(0, 8);
                  const baseUrl = entry.endpoint || CANONICAL_FRONTEND;
                  const fullUrl = `${baseUrl}/${entry.workspaceId}?token=${entry.workspaceToken}`;

                  return (
                    <Tooltip key={entry.workspaceId}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => connectToWorkspace(entry.workspaceId, entry.workspaceToken, entry.endpoint)}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-card hover:bg-accent hover:border-primary/30 transition-colors text-sm cursor-pointer"
                        >
                          <Clock className="size-3 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[200px]">{displayName}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs">
                        <p className="text-xs font-mono break-all">{fullUrl}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={handleConnect} className="space-y-4">
            <div className="space-y-2">
              <div className="relative">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="https://workspace.openagents.org/abc123?token=..."
                  value={urlInput}
                  onChange={(e) => { setUrlInput(e.target.value); setError(''); setDropdownOpen(false); }}
                  onFocus={() => history.length > 0 && setDropdownOpen(true)}
                  className="pl-10 pr-10"
                  autoFocus
                />
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown className={`size-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}

                {dropdownOpen && history.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg border bg-card shadow-lg overflow-hidden">
                    {history.map((entry) => {
                      const displayName = entry.name && entry.name !== entry.workspaceId
                        ? entry.name
                        : entry.workspaceId.slice(0, 8);

                      return (
                        <button
                          key={entry.workspaceId}
                          type="button"
                          onClick={() => {
                            setDropdownOpen(false);
                            connectToWorkspace(entry.workspaceId, entry.workspaceToken, entry.endpoint);
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left cursor-pointer"
                        >
                          <Clock className="size-3.5 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{displayName}</p>
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {entry.workspaceId}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {advancedOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                Advanced — custom API endpoint
              </button>
              {advancedOpen && (
                <div className="mt-2 space-y-1.5">
                  <div className="relative">
                    <Server className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      type="text"
                      value={apiUrlOverride}
                      onChange={(e) => {
                        setApiUrlOverride(e.target.value);
                        apiUrlEditedRef.current = true;
                      }}
                      placeholder={derivedApiUrl || 'https://workspace-endpoint.openagents.org'}
                      className="pl-10 text-xs font-mono"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Default follows the <code className="bg-muted px-1 py-0.5 rounded">{'{name}-endpoint'}</code> convention
                    {derivedApiUrl ? <> — derived <code className="bg-muted px-1 py-0.5 rounded break-all">{derivedApiUrl}</code></> : null}.
                    Override if your backend lives at a different host.
                  </p>
                </div>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={!urlInput.trim()}>
              Connect to Workspace
              <ArrowRight className="size-4 ml-1" />
            </Button>
          </form>

          {isSwitching && currentWorkspace && (
            <Button variant="ghost" className="w-full" onClick={handleCancel}>
              <ArrowLeft className="size-4 mr-1" />
              Back to current workspace
            </Button>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Get a workspace URL by running{' '}
            <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">openagents workspace create</code>
          </p>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Root — routes based on URL path
// ---------------------------------------------------------------------------

function AppRouter() {
  const [route, setRoute] = useState<{ type: 'loading' } | { type: 'selector' } | { type: 'workspace'; workspaceId: string; token: string; endpoint?: string }>({ type: 'loading' });

  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, '');
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    const endpoint = params.get('endpoint') || undefined;

    // Root path or switch mode → selector
    if (!path || path === '/' || path === '') {
      setRoute({ type: 'selector' });
      return;
    }

    // Any other path → treat as workspace ID
    const workspaceId = path.split('/').filter(Boolean)[0];
    if (workspaceId) {
      setRoute({ type: 'workspace', workspaceId, token, endpoint });
    } else {
      setRoute({ type: 'selector' });
    }
  }, []);

  if (route.type === 'loading') {
    return (
      <>
        <ElectronDragBar />
        <div className="loading-screen">Loading...</div>
      </>
    );
  }

  if (route.type === 'workspace') {
    return <WorkspaceView workspaceId={route.workspaceId} token={route.token} endpoint={route.endpoint} />;
  }

  return <SelectorView />;
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <>
        <ElectronDragBar />
        <div className="loading-screen">Loading...</div>
      </>
    }>
      <AppRouter />
    </Suspense>
  );
}
