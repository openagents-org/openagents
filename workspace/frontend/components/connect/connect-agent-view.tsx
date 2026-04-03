'use client';

import { useState, useEffect } from 'react';
import { X, Copy, Check, ExternalLink, Loader2, Terminal, ArrowRight, Key } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AgentCatalogEntry } from '@/lib/types';

// Colors assigned to agent cards based on index
const CARD_COLORS = [
  'bg-amber-500',
  'bg-emerald-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-pink-500',
  'bg-lime-500',
];

function getCardColor(index: number): string {
  return CARD_COLORS[index % CARD_COLORS.length];
}

export function ConnectAgentView() {
  const { setViewMode } = useLayout();
  const { workspace, token } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const [tokenCopied, setTokenCopied] = useState(false);

  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wsId = workspace?.workspaceId || '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    workspaceApi
      .getAgentCatalog()
      .then((entries) => {
        if (!cancelled) setCatalog(entries);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load catalog');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleCopyToken = () => {
    navigator.clipboard.writeText(token);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  // Mask token for display: show first 8 + last 4 chars
  const maskedToken = token.length > 16
    ? `${token.slice(0, 8)}${'•'.repeat(8)}${token.slice(-4)}`
    : token;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 lg:px-4 py-2 lg:py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold">Connect an Agent</h2>
        <button
          onClick={() => setViewMode('threads')}
          className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
          title="Back to threads"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-2xl mx-auto space-y-8">

          {/* ── Step 1: Workspace Token ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">1</div>
              <h3 className="text-sm font-semibold">Your Workspace Token</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3 ml-8">
              Use this token to connect agents to your workspace. Keep it private — anyone with this token can join agents.
            </p>
            <div className="ml-8">
              <button
                onClick={handleCopyToken}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed border-zinc-200 dark:border-zinc-700 hover:border-primary/40 dark:hover:border-primary/40 bg-zinc-50 dark:bg-zinc-900/50 transition-colors group"
              >
                <Key className="size-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left font-mono text-sm text-foreground tracking-wide truncate">
                  {maskedToken}
                </span>
                <span className={cn(
                  'flex items-center gap-1 text-xs font-medium shrink-0 transition-colors',
                  tokenCopied ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground group-hover:text-primary'
                )}>
                  {tokenCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {tokenCopied ? 'Copied!' : 'Copy'}
                </span>
              </button>
            </div>
          </div>

          {/* ── Step 2: Run the openagents command ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">2</div>
              <h3 className="text-sm font-semibold">Run the OpenAgents CLI</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3 ml-8">
              Open a terminal and run the graphical setup. It will guide you through connecting an agent to this workspace.
            </p>
            <div className="ml-8 space-y-3">
              {/* Command */}
              <div className="relative group">
                <pre className="bg-zinc-900 text-zinc-100 rounded-lg px-4 py-3.5 text-sm font-mono leading-relaxed overflow-x-auto">
                  <span className="text-zinc-500">$ </span>
                  <span className="text-emerald-400">openagents</span>
                </pre>
                <button
                  className="absolute top-2 right-2 size-7 flex items-center justify-center rounded-md bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                  title="Copy command"
                  onClick={() => copyToClipboard('openagents')}
                >
                  {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
              </div>

              {/* Visual flow */}
              <div className="rounded-lg border bg-background p-4">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center gap-1.5">
                    <Terminal className="size-5 text-emerald-500" />
                    <span className="text-[10px] text-muted-foreground font-medium">CLI</span>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground/40 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span className="text-xs text-foreground">Select an agent type</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="size-1.5 rounded-full bg-blue-500 shrink-0" />
                        <span className="text-xs text-foreground">Paste your workspace token</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="size-1.5 rounded-full bg-violet-500 shrink-0" />
                        <span className="text-xs text-foreground">Agent connects and appears here</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Install hint */}
              <p className="text-[11px] text-muted-foreground">
                Don&apos;t have the CLI?{' '}
                Install with{' '}
                <code className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs font-mono">pip install openagents</code>
              </p>
            </div>
          </div>

          {/* ── Step 3: Supported Agent Types ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">3</div>
              <h3 className="text-sm font-semibold">Supported Agent Types</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3 ml-8">
              The CLI supports these agent types. You&apos;ll select one during the guided setup.
            </p>
            <div className="ml-8">
              {loading && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin mr-2" />
                  <span className="text-xs">Loading agent types...</span>
                </div>
              )}

              {error && (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  Failed to load agent types.
                </div>
              )}

              {!loading && !error && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {catalog.map((entry, idx) => (
                    <div
                      key={entry.name}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
                    >
                      <div className={`size-7 rounded-md ${getCardColor(idx)} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                        {entry.label[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium">{entry.label}</span>
                          {entry.homepage && (
                            <a
                              href={entry.homepage}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                              title="Visit homepage"
                            >
                              <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">{entry.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
