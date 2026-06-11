'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Copy, Check, ExternalLink, Loader2, Terminal, Cloud, Trash2, MessageSquare, Image as ImageIcon, Volume2, Key, ChevronRight } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { AgentCatalogEntry, CloudAgentConfig, CloudAgentProvider } from '@/lib/types';
import { AgentIcon, ProviderIcon } from '@/components/icons/agent-icons';

// ---------------------------------------------------------------------------
// Brand colors for local agents and cloud providers
// ---------------------------------------------------------------------------

const AGENT_BRANDS: Record<string, { bg: string; text: string }> = {
  claude:    { bg: 'bg-orange-500',  text: 'text-white' },
  codex:     { bg: 'bg-green-600',   text: 'text-white' },
  gemini:    { bg: 'bg-blue-500',    text: 'text-white' },
  openclaw:  { bg: 'bg-violet-600',  text: 'text-white' },
  amp:       { bg: 'bg-rose-500',    text: 'text-white' },
  aider:     { bg: 'bg-emerald-500', text: 'text-white' },
  goose:     { bg: 'bg-amber-600',   text: 'text-white' },
  cline:     { bg: 'bg-cyan-500',    text: 'text-white' },
  copilot:   { bg: 'bg-indigo-500',  text: 'text-white' },
  opencode:  { bg: 'bg-teal-500',    text: 'text-white' },
  nanoclaw:  { bg: 'bg-pink-500',    text: 'text-white' },
  cursor:    { bg: 'bg-zinc-800',    text: 'text-white' },
  hermes:    { bg: 'bg-yellow-500',  text: 'text-white' },
  kimi:      { bg: 'bg-sky-500',     text: 'text-white' },
};

const PROVIDER_BRANDS: Record<string, { bg: string; text: string; accent: string }> = {
  openai:    { bg: 'bg-zinc-900 dark:bg-zinc-100', text: 'text-white dark:text-zinc-900', accent: 'border-zinc-300 dark:border-zinc-600' },
  google:    { bg: 'bg-blue-500',    text: 'text-white', accent: 'border-blue-300 dark:border-blue-700' },
  xai:       { bg: 'bg-zinc-700 dark:bg-zinc-300', text: 'text-white dark:text-zinc-900', accent: 'border-zinc-300 dark:border-zinc-600' },
  deepseek:  { bg: 'bg-blue-700',    text: 'text-white', accent: 'border-blue-300 dark:border-blue-700' },
};

function getAgentBrand(name: string) {
  return AGENT_BRANDS[name] || { bg: 'bg-zinc-500', text: 'text-white' };
}

function getProviderBrand(name: string) {
  return PROVIDER_BRANDS[name] || { bg: 'bg-zinc-500', text: 'text-white', accent: 'border-zinc-300' };
}

function CategoryIcon({ category, className }: { category: string; className?: string }) {
  if (category === 'image') return <ImageIcon className={cn('text-violet-500', className)} />;
  if (category === 'audio') return <Volume2 className={cn('text-amber-500', className)} />;
  return <MessageSquare className={cn('text-blue-500', className)} />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectAgentView() {
  const { setViewMode } = useLayout();
  const { workspace, token, refreshWorkspace } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  const [activeTab, setActiveTab] = useState<'local' | 'cloud'>('local');
  const [loading, setLoading] = useState(true);

  // Local agents
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Cloud agents
  const [cloudProviders, setCloudProviders] = useState<CloudAgentProvider[]>([]);
  const [cloudAgents, setCloudAgents] = useState<CloudAgentConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Cloud config form
  const [cfgModel, setCfgModel] = useState('');
  const [cfgName, setCfgName] = useState('');
  const [cfgKey, setCfgKey] = useState('');
  const [cfgBaseUrl, setCfgBaseUrl] = useState('');
  const [cfgPrompt, setCfgPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadCloudAgents = () => {
    workspaceApi.listCloudAgents().then(setCloudAgents).catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      workspaceApi.getAgentCatalog(),
      workspaceApi.getCloudProviders(),
      workspaceApi.listCloudAgents(),
    ])
      .then(([entries, providers, agents]) => {
        if (cancelled) return;
        setCatalog(entries);
        setCloudProviders(providers);
        setCloudAgents(agents);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Selected local agent detail
  const selectedCatalogEntry = useMemo(
    () => catalog.find((e) => e.name === selectedAgent),
    [catalog, selectedAgent],
  );

  // Selected cloud provider detail
  const selectedProviderInfo = useMemo(
    () => cloudProviders.find((p) => p.name === selectedProvider),
    [cloudProviders, selectedProvider],
  );

  const isCustomProvider = selectedProvider === 'custom';

  // Auto-select first model and generate name when provider changes
  useEffect(() => {
    if (isCustomProvider) {
      setCfgModel('');
      setCfgName('');
    } else if (selectedProviderInfo && selectedProviderInfo.models.length > 0) {
      setCfgModel(selectedProviderInfo.models[0].id);
      const base = selectedProviderInfo.models[0].label
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      setCfgName(base);
    }
    setCfgKey('');
    setCfgBaseUrl('');
    setCfgPrompt('');
    setShowAdvanced(false);
  }, [selectedProviderInfo, isCustomProvider]);

  // Update name when model changes
  useEffect(() => {
    if (!selectedProviderInfo) return;
    const model = selectedProviderInfo.models.find((m) => m.id === cfgModel);
    if (model) {
      setCfgName(model.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  }, [cfgModel, selectedProviderInfo]);

  const handleCopyToken = () => {
    navigator.clipboard.writeText(token);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const maskedToken = token.length > 16
    ? `${token.slice(0, 8)}${'•'.repeat(8)}${token.slice(-4)}`
    : token;

  const handleAddCloudAgent = async () => {
    if (!selectedProvider || !cfgModel || !cfgName || !cfgKey) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (isCustomProvider && !cfgBaseUrl) {
      toast.error('Custom endpoint requires a base URL');
      return;
    }
    setSaving(true);
    try {
      await workspaceApi.addCloudAgent({
        agentName: cfgName,
        provider: selectedProvider,
        model: cfgModel,
        apiKey: cfgKey,
        baseUrl: cfgBaseUrl || undefined,
        systemPrompt: cfgPrompt || undefined,
      });
      toast.success(`Cloud agent "@${cfgName}" added`);
      refreshWorkspace();
      loadCloudAgents();
      setSelectedProvider(null);
      setCfgKey('');
      setCfgPrompt('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add cloud agent');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCloudAgent = async (agentName: string) => {
    try {
      await workspaceApi.removeCloudAgent(agentName);
      toast.success(`Removed "@${agentName}"`);
      loadCloudAgents();
      refreshWorkspace();
    } catch {
      toast.error('Failed to remove cloud agent');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold">Connect Agents</h2>
        <button
          onClick={() => setViewMode('threads')}
          className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
          title="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b shrink-0">
        <button
          onClick={() => setActiveTab('local')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors relative',
            activeTab === 'local'
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Terminal className="size-3.5" />
          Local Agents
          {activeTab === 'local' && (
            <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-foreground rounded-full" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('cloud')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors relative',
            activeTab === 'cloud'
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Cloud className="size-3.5" />
          Cloud Agents
          {activeTab === 'cloud' && (
            <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-foreground rounded-full" />
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            <span className="text-xs">Loading...</span>
          </div>
        ) : activeTab === 'local' ? (
          <LocalAgentsTab
            catalog={catalog}
            selectedAgent={selectedAgent}
            selectedEntry={selectedCatalogEntry}
            onSelectAgent={setSelectedAgent}
            token={token}
            maskedToken={maskedToken}
            tokenCopied={tokenCopied}
            onCopyToken={handleCopyToken}
            isCopied={isCopied}
            copyToClipboard={copyToClipboard}
          />
        ) : (
          <CloudAgentsTab
            providers={cloudProviders}
            cloudAgents={cloudAgents}
            selectedProvider={selectedProvider}
            selectedProviderInfo={selectedProviderInfo}
            isCustomProvider={isCustomProvider}
            workspaceId={workspace?.workspaceId || ''}
            onSelectProvider={setSelectedProvider}
            cfgModel={cfgModel}
            setCfgModel={setCfgModel}
            cfgName={cfgName}
            setCfgName={setCfgName}
            cfgKey={cfgKey}
            setCfgKey={setCfgKey}
            cfgBaseUrl={cfgBaseUrl}
            setCfgBaseUrl={setCfgBaseUrl}
            cfgPrompt={cfgPrompt}
            setCfgPrompt={setCfgPrompt}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            saving={saving}
            onAdd={handleAddCloudAgent}
            onRemove={handleRemoveCloudAgent}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local Agents Tab
// ---------------------------------------------------------------------------

function LocalAgentsTab({
  catalog,
  selectedAgent,
  selectedEntry,
  onSelectAgent,
  token,
  maskedToken,
  tokenCopied,
  onCopyToken,
  isCopied,
  copyToClipboard,
}: {
  catalog: AgentCatalogEntry[];
  selectedAgent: string | null;
  selectedEntry: AgentCatalogEntry | undefined;
  onSelectAgent: (name: string | null) => void;
  token: string;
  maskedToken: string;
  tokenCopied: boolean;
  onCopyToken: () => void;
  isCopied: boolean;
  copyToClipboard: (text: string) => void;
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Agent grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {catalog.map((entry) => {
          const brand = getAgentBrand(entry.name);
          const isSelected = selectedAgent === entry.name;
          return (
            <button
              key={entry.name}
              onClick={() => onSelectAgent(isSelected ? null : entry.name)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-3 rounded-lg border text-left transition-all',
                isSelected
                  ? 'border-foreground/20 bg-zinc-50 dark:bg-zinc-800/50 ring-1 ring-foreground/10'
                  : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30',
              )}
            >
              <div className="size-8 shrink-0 flex items-center justify-center">
                <AgentIcon name={entry.name} size={32} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium leading-tight truncate">{entry.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {entry.builtin ? 'Built-in' : entry.tags?.[0] || 'Open Source'}
                </div>
              </div>
              {isSelected && <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />}
            </button>
          );
        })}
      </div>

      {/* Selected agent detail */}
      {selectedEntry && (
        <div className="rounded-lg border bg-zinc-50/50 dark:bg-zinc-900/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="px-4 py-3 border-b bg-background">
            <div className="flex items-center gap-3">
              <div className="size-9 flex items-center justify-center shrink-0">
                <AgentIcon name={selectedEntry.name} size={36} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{selectedEntry.label}</h3>
                  {selectedEntry.homepage && (
                    <a
                      href={selectedEntry.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{selectedEntry.description}</p>
              </div>
            </div>
          </div>

          {/* Connection methods */}
          <div className="p-4 space-y-4">
            {/* Option A: Desktop App */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-foreground">Option A</span>
                <span className="text-xs text-muted-foreground">— Desktop App (recommended)</span>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                Download the OpenAgents launcher for a visual setup experience.
              </p>
              <div className="flex gap-2">
                <a
                  href="https://openagents.org/api/download/launcher/mac"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center px-3 py-2 text-[11px] font-medium rounded-md border hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  macOS
                </a>
                <a
                  href="https://openagents.org/api/download/launcher/windows"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center px-3 py-2 text-[11px] font-medium rounded-md border hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Windows
                </a>
                <a
                  href="https://openagents.org/api/download/launcher/linux-appimage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center px-3 py-2 text-[11px] font-medium rounded-md border hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Linux
                </a>
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
                <span className="text-xs font-semibold text-foreground">Option B</span>
                <span className="text-xs text-muted-foreground">— Command Line</span>
              </div>

              {/* Step 1: Install CLI */}
              <div className="space-y-3">
                <div>
                  <span className="text-[11px] text-muted-foreground">1. Install the OpenAgents CLI</span>
                  <div className="relative group mt-1">
                    <pre className="bg-zinc-900 text-zinc-100 rounded-md px-3.5 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
                      <span className="text-zinc-500">$ </span>
                      <span className="text-emerald-400">curl -fsSL https://openagents.org/install.sh | bash</span>
                    </pre>
                    <button
                      className="absolute top-1.5 right-1.5 size-6 flex items-center justify-center rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                      onClick={() => copyToClipboard('curl -fsSL https://openagents.org/install.sh | bash')}
                    >
                      {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                  </div>
                </div>

                {/* Step 2: Install agent runtime */}
                <div>
                  <span className="text-[11px] text-muted-foreground">2. Install the {selectedEntry.label} runtime</span>
                  <div className="relative group mt-1">
                    <pre className="bg-zinc-900 text-zinc-100 rounded-md px-3.5 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
                      <span className="text-zinc-500">$ </span>
                      <span className="text-emerald-400">agn install {selectedEntry.name}</span>
                    </pre>
                    <button
                      className="absolute top-1.5 right-1.5 size-6 flex items-center justify-center rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                      onClick={() => copyToClipboard(`agn install ${selectedEntry.name}`)}
                    >
                      {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                  </div>
                </div>

                {/* Step 3: Create agent instance */}
                <div>
                  <span className="text-[11px] text-muted-foreground">3. Create an agent instance</span>
                  <div className="relative group mt-1">
                    <pre className="bg-zinc-900 text-zinc-100 rounded-md px-3.5 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
                      <span className="text-zinc-500">$ </span>
                      <span className="text-emerald-400">agn create my-{selectedEntry.name} --type {selectedEntry.name}</span>
                    </pre>
                    <button
                      type="button"
                      className="absolute top-1.5 right-1.5 size-6 flex items-center justify-center rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                      onClick={() => copyToClipboard(`agn create my-${selectedEntry.name} --type ${selectedEntry.name}`)}
                    >
                      {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                  </div>
                </div>

                {/* Step 4: Connect */}
                <div>
                  <span className="text-[11px] text-muted-foreground">4. Connect to this workspace</span>
                  <div className="relative group mt-1">
                    <pre className="bg-zinc-900 text-zinc-100 rounded-md px-3.5 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
                      <span className="text-zinc-500">$ </span>
                      <span className="text-emerald-400">agn connect my-{selectedEntry.name} {token.slice(0, 8)}...</span>
                    </pre>
                    <button
                      className="absolute top-1.5 right-1.5 size-6 flex items-center justify-center rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                      onClick={() => copyToClipboard(`agn connect my-${selectedEntry.name} ${token}`)}
                    >
                      {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                  </div>
                </div>

                {/* Step 5: Start daemon */}
                <div>
                  <span className="text-[11px] text-muted-foreground">5. Start the daemon</span>
                  <div className="relative group mt-1">
                    <pre className="bg-zinc-900 text-zinc-100 rounded-md px-3.5 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
                      <span className="text-zinc-500">$ </span>
                      <span className="text-emerald-400">agn up</span>
                    </pre>
                    <button
                      type="button"
                      className="absolute top-1.5 right-1.5 size-6 flex items-center justify-center rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                      onClick={() => copyToClipboard('agn up')}
                    >
                      {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    If the daemon is already running, connect will notify it automatically.
                  </p>
                </div>

                {/* Step 6: Verify status */}
                <div>
                  <span className="text-[11px] text-muted-foreground">6. Verify the agent is running</span>
                  <div className="relative group mt-1">
                    <pre className="bg-zinc-900 text-zinc-100 rounded-md px-3.5 py-2.5 text-xs font-mono leading-relaxed overflow-x-auto">
                      <span className="text-zinc-500">$ </span>
                      <span className="text-emerald-400">agn status</span>
                    </pre>
                    <button
                      type="button"
                      className="absolute top-1.5 right-1.5 size-6 flex items-center justify-center rounded bg-zinc-700/80 hover:bg-zinc-600 text-zinc-300 hover:text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                      onClick={() => copyToClipboard('agn status')}
                    >
                      {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Token */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Key className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Workspace Token</span>
              </div>
              <button
                onClick={onCopyToken}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md border bg-background hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors group"
              >
                <span className="flex-1 text-left font-mono text-xs text-muted-foreground truncate">
                  {maskedToken}
                </span>
                <span className={cn(
                  'flex items-center gap-1 text-[10px] font-medium shrink-0 transition-colors',
                  tokenCopied ? 'text-emerald-600' : 'text-muted-foreground group-hover:text-foreground',
                )}>
                  {tokenCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {tokenCopied ? 'Copied' : 'Copy'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hint when nothing selected */}
      {!selectedEntry && (
        <p className="text-center text-xs text-muted-foreground py-4">
          Select an agent above to see connection instructions
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cloud Agents Tab
// ---------------------------------------------------------------------------

function CloudAgentsTab({
  providers,
  cloudAgents,
  selectedProvider,
  selectedProviderInfo,
  isCustomProvider,
  workspaceId,
  onSelectProvider,
  cfgModel,
  setCfgModel,
  cfgName,
  setCfgName,
  cfgKey,
  setCfgKey,
  cfgBaseUrl,
  setCfgBaseUrl,
  cfgPrompt,
  setCfgPrompt,
  showAdvanced,
  setShowAdvanced,
  saving,
  onAdd,
  onRemove,
}: {
  providers: CloudAgentProvider[];
  cloudAgents: CloudAgentConfig[];
  selectedProvider: string | null;
  selectedProviderInfo: CloudAgentProvider | undefined;
  isCustomProvider: boolean;
  workspaceId: string;
  onSelectProvider: (name: string | null) => void;
  cfgModel: string;
  setCfgModel: (v: string) => void;
  cfgName: string;
  setCfgName: (v: string) => void;
  cfgKey: string;
  setCfgKey: (v: string) => void;
  cfgBaseUrl: string;
  setCfgBaseUrl: (v: string) => void;
  cfgPrompt: string;
  setCfgPrompt: (v: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  saving: boolean;
  onAdd: () => void;
  onRemove: (name: string) => void;
}) {
  const providerGroups = [
    { label: 'Chat Models', names: ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral', 'sensenova'] },
    { label: 'Search & Agents', names: ['perplexity', 'manus'] },
    { label: 'Fast Inference', names: ['groq', 'together', 'fireworks', 'openrouter', 'sambanova', 'cerebras'] },
    { label: 'Image & Media', names: ['stability', 'replicate', 'fal', 'elevenlabs'] },
    { label: 'Custom', names: ['custom'] },
  ];

  // When a provider is selected, show config view instead of grid
  if (selectedProviderInfo) {
    return (
      <div className="p-4 space-y-4">
        {/* Back button */}
        <button
          onClick={() => onSelectProvider(null)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className="size-3 rotate-180" />
          All providers
        </button>

        <div className="rounded-lg border bg-zinc-50/50 dark:bg-zinc-900/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-3 border-b bg-background">
            <div className="flex items-center gap-2.5">
              <div className="size-8 flex items-center justify-center shrink-0">
                <ProviderIcon name={selectedProviderInfo.name} size={32} />
              </div>
              <div>
                <h3 className="text-sm font-semibold">{selectedProviderInfo.label}</h3>
                <p className="text-[11px] text-muted-foreground">
                  {isCustomProvider ? 'Connect any OpenAI-compatible endpoint' : 'Configure and add a cloud agent'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-3">
            {/* Custom endpoint: Base URL */}
            {isCustomProvider && (
              <div className="space-y-1.5">
                <Label htmlFor="cloud-base-url" className="text-xs">Endpoint URL</Label>
                <Input
                  id="cloud-base-url"
                  value={cfgBaseUrl}
                  onChange={(e) => setCfgBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="text-sm font-mono h-9"
                />
                <p className="text-[10px] text-muted-foreground">/v1 is appended automatically if needed</p>
              </div>
            )}

            {/* Model selector — list for known providers, text input for custom */}
            {isCustomProvider ? (
              <div className="space-y-1.5">
                <Label htmlFor="cloud-model" className="text-xs">Model Name</Label>
                <Input
                  id="cloud-model"
                  value={cfgModel}
                  onChange={(e) => setCfgModel(e.target.value)}
                  placeholder="e.g. gpt-4o, deepseek-chat, qwen-turbo"
                  className="text-sm font-mono h-9"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Model</Label>
                <div className="grid grid-cols-1 gap-1">
                  {selectedProviderInfo.models.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setCfgModel(m.id)}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs text-left transition-colors',
                        cfgModel === m.id
                          ? 'border-foreground/20 bg-background ring-1 ring-foreground/5'
                          : 'border-transparent hover:bg-background/60',
                      )}
                    >
                      <CategoryIcon category={m.category} className="size-3.5 shrink-0" />
                      <span className="font-medium flex-1">{m.label}</span>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        {m.category}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Google OAuth option */}
            {selectedProvider === 'google' && (
              <>
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org'}/v1/cloud-agents/google/auth?network=${encodeURIComponent(workspaceId)}&agent_name=${encodeURIComponent(cfgName || 'gemini')}&model=${encodeURIComponent(cfgModel || 'gemini-3.5-flash')}`}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-lg border-2 border-blue-200 dark:border-blue-800 bg-white dark:bg-zinc-900 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-sm font-medium"
                >
                  <svg viewBox="0 0 24 24" className="size-4" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Sign in with Google
                </a>
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t" />
                  <span className="text-[10px] text-muted-foreground">or use API key</span>
                  <div className="flex-1 border-t" />
                </div>
              </>
            )}

            {/* Agent name */}
            <div className="space-y-1.5">
              <Label htmlFor="cloud-name" className="text-xs">Agent Name</Label>
              <Input
                id="cloud-name"
                value={cfgName}
                onChange={(e) => setCfgName(e.target.value)}
                placeholder="e.g. chatgpt"
                className="text-sm h-9"
              />
              <p className="text-[10px] text-muted-foreground">Use this to @mention the agent in chat</p>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <Label htmlFor="cloud-key" className="text-xs">API Key</Label>
              <Input
                id="cloud-key"
                type="password"
                value={cfgKey}
                onChange={(e) => setCfgKey(e.target.value)}
                placeholder="sk-..."
                className="text-sm font-mono h-9"
              />
            </div>

            {/* Advanced */}
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAdvanced ? 'Hide' : 'Show'} advanced options
              </button>
              {showAdvanced && (
                <div className="mt-2">
                  <Label htmlFor="cloud-prompt" className="text-xs">System Prompt</Label>
                  <Textarea
                    id="cloud-prompt"
                    value={cfgPrompt}
                    onChange={(e) => setCfgPrompt(e.target.value)}
                    placeholder="Custom instructions for this agent..."
                    className="text-sm min-h-[50px] mt-1.5"
                  />
                </div>
              )}
            </div>

            {/* Add button */}
            <Button
              onClick={onAdd}
              disabled={saving || !cfgName || !cfgKey || !cfgModel || (isCustomProvider && !cfgBaseUrl)}
              className="w-full"
              size="sm"
            >
              {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
              Add Agent
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Grid view — no provider selected
  return (
    <div className="p-4 space-y-3">
      {providerGroups.map((group) => {
        const groupProviders = group.names
          .map((n) => providers.find((p) => p.name === n))
          .filter(Boolean) as typeof providers;
        if (groupProviders.length === 0) return null;
        return (
          <div key={group.label}>
            <div className="flex items-center gap-2 mb-1.5 px-0.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{group.label}</span>
              <div className="flex-1 border-t" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {groupProviders.map((p) => {
                const brand = getProviderBrand(p.name);
                return (
                  <button
                    key={p.name}
                    onClick={() => onSelectProvider(p.name)}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 text-left transition-all"
                  >
                    <div className="size-6 shrink-0 flex items-center justify-center">
                      <ProviderIcon name={p.name} size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium leading-tight truncate">{p.label}</div>
                      <div className="text-[9px] text-muted-foreground">{p.models.length} models</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Connected cloud agents */}
      {cloudAgents.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Connected</span>
            <div className="flex-1 border-t" />
          </div>
          {cloudAgents.map((agent) => (
            <div
              key={agent.agentName}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border bg-background"
            >
              <div className="size-7 flex items-center justify-center shrink-0">
                <ProviderIcon name={agent.provider} size={28} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">@{agent.agentName}</span>
                  <CategoryIcon category={agent.category} className="size-2.5" />
                </div>
                <div className="text-[10px] text-muted-foreground">{agent.model}</div>
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">{agent.apiKeyMasked}</span>
              <button
                onClick={() => onRemove(agent.agentName)}
                className="size-6 flex items-center justify-center rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
                title="Remove"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
