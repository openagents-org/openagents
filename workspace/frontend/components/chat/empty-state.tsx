'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Rocket, Copy, Check, ChevronRight, Key, Cloud, ExternalLink, Loader2, ArrowLeft } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { capture } from '@/lib/analytics';
import { useLayout } from '@/components/layout/layout-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { AgentIcon } from '@/components/icons/agent-icons';
import { cn } from '@/lib/utils';
import type { AgentCatalogEntry } from '@/lib/types';

export function EmptyState() {
  const { agents, token } = useWorkspace();
  const { setViewMode } = useLayout();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const hasOnlineAgent = agents.some((a) => a.status === 'online');

  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    workspaceApi
      .getAgentCatalog()
      .then((entries) => { if (!cancelled) setCatalog(entries); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // The onboarding view auto-shows when a workspace is open with no agent connected.
  // It's a conditional render (no route/pageview), so fire an explicit event here.
  // Debounced ~1s so the brief no-agents flash during initial load doesn't count;
  // if agents arrive first, this component unmounts and the timer is cleared.
  // The active workspace group (set on workspace open) auto-attaches for funnel joins.
  const onboardingTracked = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (onboardingTracked.current) return;
      onboardingTracked.current = true;
      capture('workspace_onboarding_viewed');
    }, 1000);
    return () => clearTimeout(t);
  }, []);

  const selectedEntry = useMemo(
    () => catalog.find((e) => e.name === selectedAgent),
    [catalog, selectedAgent],
  );

  const handleCopyToken = () => {
    navigator.clipboard.writeText(token);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  if (hasOnlineAgent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <div className="flex items-center p-4 rounded-full bg-emerald-500/10">
          <Rocket className="size-8 text-emerald-500" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">You&apos;re all set!</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your agent is online. Send a message below to start collaborating.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center h-full overflow-y-auto p-6 sm:p-8">
      <div className="w-full max-w-2xl space-y-6 py-8">
        {/* Back to the agent picker — shown once an agent is selected so the
            install instructions can take over the view without scrolling. */}
        {selectedEntry && (
          <button
            onClick={() => setSelectedAgent(null)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            Back to agents
          </button>
        )}

        {/* Header */}
        {!selectedEntry && (
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Connect your first agent</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Pick an agent you already have installed, or choose one to set up.
            </p>
          </div>
        )}

        {/* Agent catalog grid */}
        {!selectedEntry && (loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            <span className="text-sm">Loading agents...</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {catalog.map((entry) => {
              const isSelected = selectedAgent === entry.name;
              return (
                <button
                  key={entry.name}
                  onClick={() => setSelectedAgent(isSelected ? null : entry.name)}
                  className={cn(
                    'flex flex-col items-center gap-2 px-3 py-4 rounded-xl border text-center transition-all',
                    isSelected
                      ? 'border-primary/30 bg-primary/[0.04] ring-1 ring-primary/10 shadow-sm'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30',
                  )}
                >
                  <div className="size-10 flex items-center justify-center">
                    <AgentIcon name={entry.name} size={40} />
                  </div>
                  <div className="min-w-0 w-full">
                    <div className="text-sm font-medium leading-tight truncate">{entry.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {entry.tags?.[0] || 'Agent'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}

        {/* Selected agent — connection instructions */}
        {selectedEntry && (
          <div className="rounded-xl border bg-card overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Agent header */}
            <div className="px-5 py-4 border-b bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="size-10 flex items-center justify-center shrink-0">
                  <AgentIcon name={selectedEntry.name} size={40} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold">{selectedEntry.label}</h3>
                    {selectedEntry.homepage && (
                      <a
                        href={selectedEntry.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{selectedEntry.description}</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Option A: Desktop App */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold">Option A</span>
                  <span className="text-xs text-muted-foreground">— Desktop App (recommended)</span>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2.5">
                  Download the OpenAgents Launcher for a visual setup experience.
                </p>
                <div className="flex gap-2">
                  {[
                    { label: 'macOS', platform: 'mac-arm64', href: 'https://openagents.org/api/download/launcher/mac' },
                    { label: 'Windows', platform: 'windows', href: 'https://openagents.org/api/download/launcher/windows' },
                    { label: 'Linux', platform: 'linux-appimage', href: 'https://openagents.org/api/download/launcher/linux-appimage' },
                  ].map((dl) => (
                    <a
                      key={dl.label}
                      href={dl.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => capture('launcher_download_clicked', {
                        platform: dl.platform,
                        source: 'workspace_onboarding',
                        agent_type: selectedEntry.name,
                      })}
                      className="flex-1 text-center px-3 py-2.5 text-xs font-medium rounded-lg border hover:bg-accent transition-colors"
                    >
                      {dl.label}
                    </a>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 border-t" />
                <span className="text-[10px] text-muted-foreground">or</span>
                <div className="flex-1 border-t" />
              </div>

              {/* Option B: CLI */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold">Option B</span>
                  <span className="text-xs text-muted-foreground">— Command Line</span>
                </div>
                <div className="space-y-3">
                  <CliStep
                    step="1"
                    label="Install the OpenAgents CLI — macOS / Linux"
                    command="curl -fsSL https://openagents.org/install.sh | bash"
                    isCopied={isCopied}
                    onCopy={(cmd) => {
                      capture('cli_install_copied', {
                        source: 'workspace_onboarding',
                        agent_type: selectedEntry.name,
                        os: 'unix',
                      });
                      copyToClipboard(cmd);
                    }}
                  />
                  <CliStep
                    label="Windows (PowerShell)"
                    command="irm https://openagents.org/install.ps1 | iex"
                    isCopied={isCopied}
                    onCopy={(cmd) => {
                      capture('cli_install_copied', {
                        source: 'workspace_onboarding',
                        agent_type: selectedEntry.name,
                        os: 'windows',
                      });
                      copyToClipboard(cmd);
                    }}
                  />
                  <CliStep
                    step="2"
                    label={`Install the ${selectedEntry.label} runtime`}
                    command={`agn install ${selectedEntry.name}`}
                    isCopied={isCopied}
                    onCopy={copyToClipboard}
                  />
                  <CliStep
                    step="3"
                    label="Connect to this workspace"
                    command={`agn connect my-${selectedEntry.name} ${token.slice(0, 8)}...`}
                    copyCommand={`agn connect my-${selectedEntry.name} ${token}`}
                    isCopied={isCopied}
                    onCopy={copyToClipboard}
                  />
                </div>
              </div>

              {/* Token */}
              {token && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Key className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Workspace Token</span>
                  </div>
                  <button
                    onClick={handleCopyToken}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border bg-background hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors group"
                  >
                    <span className="flex-1 text-left font-mono text-xs text-muted-foreground truncate">
                      {token.length > 16
                        ? `${token.slice(0, 8)}${'•'.repeat(8)}${token.slice(-4)}`
                        : token}
                    </span>
                    <span className={cn(
                      'flex items-center gap-1 text-[11px] font-medium shrink-0 transition-colors',
                      tokenCopied ? 'text-emerald-600' : 'text-muted-foreground group-hover:text-foreground',
                    )}>
                      {tokenCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {tokenCopied ? 'Copied' : 'Copy'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cloud agents fallback */}
        {!selectedEntry && (
        <div className="text-center space-y-2 pt-2">
          <div className="flex items-center gap-3 justify-center">
            <div className="w-16 border-t" />
            <span className="text-[11px] text-muted-foreground">or</span>
            <div className="w-16 border-t" />
          </div>
          <button
            onClick={() => setViewMode('connect')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border hover:bg-accent transition-colors text-sm group"
          >
            <Cloud className="size-4 text-muted-foreground" />
            <span className="font-medium">Try Cloud Agents</span>
            <span className="text-xs text-muted-foreground">— paste an API key, no install needed</span>
            <ChevronRight className="size-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

function CliStep({
  step,
  label,
  command,
  copyCommand,
  isCopied,
  onCopy,
}: {
  step?: string;
  label: string;
  command: string;
  copyCommand?: string;
  isCopied: boolean;
  onCopy: (text: string) => void;
}) {
  return (
    <div>
      <span className="text-[11px] text-muted-foreground">{step ? `${step}. ` : ''}{label}</span>
      <div className="relative group mt-1">
        <pre className="bg-zinc-900 text-zinc-100 rounded-lg px-3.5 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
          <span className="text-zinc-500">$ </span>
          <span className="text-emerald-400">{command}</span>
        </pre>
        <button
          className="absolute top-1.5 right-1.5 size-6 flex items-center justify-center rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
          onClick={() => onCopy(copyCommand || command)}
        >
          {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
    </div>
  );
}
