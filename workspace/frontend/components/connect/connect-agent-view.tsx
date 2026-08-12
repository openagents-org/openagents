'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Copy, Check, ExternalLink, Loader2, Terminal, Cloud, Trash2, MessageSquare, Image as ImageIcon, Volume2, Key, ChevronRight, Server, Laptop, Monitor, RefreshCw, Plus, HardDrive } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { useWorkspace } from '@/lib/workspace-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useT, useFormatters } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import type { AgentCatalogEntry, CloudAgentConfig, CloudAgentProvider, WorkspaceNode, PairingCode } from '@/lib/types';
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
  return <MessageSquare className={cn('text-foreground/70', className)} />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectAgentView() {
  const t = useT();
  const { openView } = useLayout();
  const { workspace, token, refreshWorkspace, agents } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  const [activeTab, setActiveTab] = useState<'local' | 'cloud' | 'node'>('node');
  const [loading, setLoading] = useState(true);

  // Nodes (connect-a-node)
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);

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

  // The built-in Yumi assistant uses the server-held key for the `openagents`
  // provider, so it is present when a roster agent is flagged builtin/named yumi
  // or a cloud agent named yumi exists. The dedicated card is hidden then.
  const yumiPresent = useMemo(
    () =>
      agents.some((a) => a.builtin || a.agentName === 'yumi') ||
      cloudAgents.some((a) => a.agentName === 'yumi'),
    [agents, cloudAgents],
  );

  const handleAddBuiltinYumi = async () => {
    setSaving(true);
    try {
      await workspaceApi.addCloudAgent({
        agentName: 'yumi',
        provider: 'openagents',
        model: 'deepseek-v4-pro',
        apiKey: '',
      });
      toast.success(t('connect.yumiAdded'));
      refreshWorkspace();
      loadCloudAgents();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('connect.cloudAgentAddFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddCloudAgent = async () => {
    // The `openagents` provider injects the server-held key, so it is exempt
    // from the API-key requirement the generic provider forms enforce.
    const needsKey = selectedProvider !== 'openagents';
    if (!selectedProvider || !cfgModel || !cfgName || (needsKey && !cfgKey)) {
      toast.error(t('connect.missingFields'));
      return;
    }
    if (isCustomProvider && !cfgBaseUrl) {
      toast.error(t('connect.customNeedsBaseUrl'));
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
      toast.success(t('connect.cloudAgentAdded', { name: cfgName }));
      refreshWorkspace();
      loadCloudAgents();
      setSelectedProvider(null);
      setCfgKey('');
      setCfgPrompt('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('connect.cloudAgentAddFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCloudAgent = async (agentName: string) => {
    try {
      await workspaceApi.removeCloudAgent(agentName);
      toast.success(t('connect.cloudAgentRemoved', { name: agentName }));
      loadCloudAgents();
      refreshWorkspace();
    } catch {
      toast.error(t('connect.cloudAgentRemoveFailed'));
    }
  };

  // --- Nodes ---------------------------------------------------------------

  const loadNodes = useCallback(async (showSpinner = false) => {
    if (showSpinner) setNodesLoading(true);
    try {
      const list = await workspaceApi.listNodes();
      setNodes(list);
    } catch {
      /* transient — keep the last known list */
    } finally {
      if (showSpinner) setNodesLoading(false);
    }
  }, []);

  // Load nodes when the tab is opened, then poll for live status while it's
  // visible so a device that pairs shows up (and heartbeats advance) on its own.
  useEffect(() => {
    if (activeTab !== 'node') return;
    loadNodes(true);
    const id = setInterval(() => loadNodes(false), 10000);
    return () => clearInterval(id);
  }, [activeTab, loadNodes]);

  const handleGeneratePairingCode = async () => {
    setPairingLoading(true);
    try {
      const code = await workspaceApi.createPairingCode();
      setPairing(code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(/40[13]/.test(msg) ? t('connect.nodePairingForbidden') : t('connect.nodePairingFailed'));
    } finally {
      setPairingLoading(false);
    }
  };

  const handleDismissPairing = () => {
    setPairing(null);
    loadNodes(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header — title in the app header, actions in its toolbar */}
      <DetailHeader title={<h2 className="text-sm font-semibold">{t('connect.title')}</h2>}>
        <button
          onClick={() => openView('threads')}
          className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
          title={t('common.close')}
        >
          <X className="size-4" />
        </button>
      </DetailHeader>

      {/* Tabs — the three ways to connect, nodes first. A segmented control
          reads cleaner and more app-like than underlined text tabs. */}
      <div className="px-4 pt-3 pb-1 shrink-0">
        <div className="flex gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/60">
          {([
            { id: 'node', icon: Server, label: t('connect.tabNode') },
            { id: 'local', icon: Terminal, label: t('connect.tabLocal') },
            { id: 'cloud', icon: Cloud, label: t('connect.tabCloud') },
          ] as const).map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all',
                  active
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className={cn('size-3.5', active && 'text-primary')} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            <span className="text-xs">{t('common.loading')}</span>
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
        ) : activeTab === 'node' ? (
          <NodesTab
            nodes={nodes}
            catalog={catalog}
            loading={nodesLoading}
            pairing={pairing}
            pairingLoading={pairingLoading}
            onGenerate={handleGeneratePairingCode}
            onDismissPairing={handleDismissPairing}
            onRefresh={() => loadNodes(true)}
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
            showBuiltinCard={!yumiPresent}
            onAddBuiltin={handleAddBuiltinYumi}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nodes Tab — devices running the launcher daemon (connect-a-node)
// ---------------------------------------------------------------------------

const INSTALL_COMMAND = 'curl -fsSL https://openagents.org/install.sh | bash';

function deviceIcon(deviceType: string, className?: string) {
  switch (deviceType) {
    case 'server': return <Server className={className} />;
    case 'laptop': return <Laptop className={className} />;
    case 'desktop': return <Monitor className={className} />;
    default: return <HardDrive className={className} />;
  }
}

/** A colored gradient tile per device type — gives each node card visual identity. */
function deviceTile(deviceType: string) {
  switch (deviceType) {
    case 'server': return 'bg-gradient-to-br from-blue-500 to-indigo-600';
    case 'laptop': return 'bg-gradient-to-br from-violet-500 to-purple-600';
    case 'desktop': return 'bg-gradient-to-br from-emerald-500 to-teal-600';
    default: return 'bg-gradient-to-br from-zinc-500 to-zinc-700';
  }
}

function deviceLabel(t: ReturnType<typeof useT>, deviceType: string) {
  switch (deviceType) {
    case 'server': return t('connect.nodeDeviceServer');
    case 'laptop': return t('connect.nodeDeviceLaptop');
    case 'desktop': return t('connect.nodeDeviceDesktop');
    default: return t('connect.nodeDeviceUnknown');
  }
}

/** A monospace command line with a copy button. */
function CommandRow({ command }: { command: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2 rounded-md border bg-zinc-950 dark:bg-black px-3 py-2">
      <code className="flex-1 min-w-0 text-[11px] font-mono text-zinc-100 overflow-x-auto whitespace-nowrap">
        {command}
      </code>
      <button
        onClick={copy}
        className="shrink-0 size-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/10 transition-colors"
        title={t('connect.nodeCopyCommand')}
      >
        {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function PairingPanel({
  pairing,
  onDismiss,
}: {
  pairing: PairingCode;
  onDismiss: () => void;
}) {
  const t = useT();
  const [codeCopied, setCodeCopied] = useState(false);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [pairing.expiresAt]);

  const expired = remaining <= 0;
  const minutes = Math.max(1, Math.ceil(remaining / 60));

  const copyCode = () => {
    navigator.clipboard.writeText(pairing.code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border bg-background overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <span className="text-xs font-semibold">{t('connect.nodePairingTitle')}</span>
        <span className={cn(
          'text-[10px] font-medium rounded-full px-2 py-0.5',
          expired ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-600 dark:text-amber-500',
        )}>
          {expired ? t('connect.nodePairingExpired') : t('connect.nodePairingExpires', { minutes })}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* The code itself — the hero of this panel */}
        <button
          onClick={copyCode}
          disabled={expired}
          className={cn(
            'group w-full flex items-center justify-center gap-3 rounded-xl border-2 border-dashed py-6 transition-colors',
            expired
              ? 'opacity-50 cursor-not-allowed border-zinc-200 dark:border-zinc-800'
              : 'border-primary/25 bg-gradient-to-b from-primary/[0.04] to-transparent hover:from-primary/[0.08]',
          )}
          title={t('connect.nodeCopyCode')}
        >
          <span className="text-[2rem] leading-none font-mono font-bold tracking-[0.25em] tabular-nums">{pairing.code}</span>
          {codeCopied
            ? <Check className="size-5 text-green-500" />
            : <Copy className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" />}
        </button>

        <p className="text-[11px] text-muted-foreground">{t('connect.nodePairingHint')}</p>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
            <span className="size-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-semibold">1</span>
            {t('connect.nodePairingInstall')}
          </div>
          <CommandRow command={INSTALL_COMMAND} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
            <span className="size-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-semibold">2</span>
            {t('connect.nodePairingConnect')}
          </div>
          <CommandRow command={`agn node connect ${pairing.code}`} />
        </div>

        <div className="flex justify-end pt-1">
          <Button size="sm" variant="outline" onClick={onDismiss}>{t('connect.nodeDone')}</Button>
        </div>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  onAddAgent,
  onChanged,
}: {
  node: WorkspaceNode;
  onAddAgent: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { timeAgo } = useFormatters();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const online = node.status === 'online';
  const agents = node.agents || [];
  // Compact preview shown on the collapsed row: a few agent-type logos + how
  // many are running, so you can tell what's on a node at a glance.
  const previewAgents = agents.slice(0, 5);
  const extraAgents = agents.length - previewAgents.length;
  const runningCount = agents.filter((a) => a.status === 'running').length;

  const handleRemoveNode = async () => {
    const ok = await confirm({
      title: t('connect.nodeRemoveTitle', { node: node.name }),
      description: t('connect.nodeRemoveBody'),
      confirmText: t('connect.nodeRemove'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await workspaceApi.deleteNode(node.nodeId);
      toast.success(t('connect.nodeRemoved'));
      onChanged();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(/40[13]/.test(msg) ? t('connect.nodeRemoveForbidden') : t('connect.nodeRemoveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const queue = async (
    action: 'start_agent' | 'stop_agent' | 'remove_agent',
    args: Record<string, unknown>,
  ) => {
    setBusy(true);
    try {
      await workspaceApi.enqueueNodeCommand(node.nodeId, action, args);
      toast.success(t('connect.nodeCommandQueued', { node: node.name }));
      // Give the node a moment to pick the command up on its next heartbeat.
      setTimeout(onChanged, 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(/40[13]/.test(msg) ? t('connect.nodeCommandForbidden') : t('connect.nodeCommandFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border bg-background overflow-hidden group transition-shadow hover:shadow-sm">
      {/* Node summary row */}
      <div className="w-full flex items-center gap-3 px-3 py-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-3 text-left"
        >
          <div className={cn('size-10 shrink-0 flex items-center justify-center rounded-xl text-white shadow-sm', deviceTile(node.deviceType))}>
            {deviceIcon(node.deviceType, 'size-5')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold truncate">{node.name}</span>
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">{deviceLabel(t, node.deviceType)}</span>
            </div>
            {agents.length > 0 ? (
              /* Agent preview: overlapping type logos + running count */
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex -space-x-1.5">
                  {previewAgents.map((a) => (
                    <div key={a.name} className="relative" title={`@${a.name} · ${a.type} · ${a.status}`}>
                      <span className="size-5 rounded-md border bg-background ring-2 ring-background flex items-center justify-center overflow-hidden">
                        <AgentIcon name={a.type} size={13} />
                      </span>
                      <span className={cn(
                        'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-background',
                        a.status === 'running' ? 'bg-green-500' : 'bg-zinc-400',
                      )} />
                    </div>
                  ))}
                  {extraAgents > 0 && (
                    <div className="size-5 rounded-md border bg-muted ring-2 ring-background flex items-center justify-center text-[8px] font-semibold text-muted-foreground">
                      +{extraAgents}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {runningCount > 0
                    ? t('connect.nodeCountRunning', { count: runningCount })
                    : `${agents.length} ${t('connect.nodeAgents').toLowerCase()}`}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 mt-1">
                {node.os && <span className="text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-px">{node.os}</span>}
                {node.launcherVersion && <span className="text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-px">v{node.launcherVersion}</span>}
              </div>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <span className={cn(
              'flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2 py-0.5',
              online ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-zinc-500/10 text-muted-foreground',
            )}>
              <span className={cn('size-1.5 rounded-full', online ? 'bg-green-500 animate-pulse' : 'bg-zinc-400')} />
              {online ? t('connect.nodeStatusOnline') : t('connect.nodeStatusOffline')}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {node.lastHeartbeatAt
                ? t('connect.nodeLastSeen', { time: timeAgo(node.lastHeartbeatAt) })
                : t('connect.nodeNeverSeen')}
            </span>
          </div>
        </button>
        {/* Remove node — always available (handy for offline devices) */}
        <button
          onClick={handleRemoveNode}
          disabled={busy}
          title={t('connect.nodeRemove')}
          aria-label={t('connect.nodeRemove')}
          className="shrink-0 size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 size-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Toggle details"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
      </div>

      {/* Expanded: agent roster + management */}
      {expanded && (
        <div className="border-t px-3 py-3 space-y-3 bg-zinc-50/40 dark:bg-zinc-900/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground">{t('connect.nodeAgents')}</span>
            <Button size="sm" variant="outline" onClick={onAddAgent}>
              <Plus className="size-3.5 mr-1" />{t('connect.nodeAddAgent')}
            </Button>
          </div>

          {!online && (
            <p className="text-[10px] text-amber-600 dark:text-amber-500">{t('connect.nodeOfflineActionHint')}</p>
          )}

          {/* Roster */}
          {agents.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t('connect.nodeNoAgents')}</p>
          ) : (
            <div className="space-y-1.5">
              {agents.map((a) => {
                const running = a.status === 'running';
                return (
                  <div key={a.name} className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
                    <AgentIcon name={a.type} size={18} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium truncate">@{a.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{a.type} · {a.status}</div>
                    </div>
                    {running ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => queue('stop_agent', { name: a.name })}>
                        {t('connect.nodeStop')}
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => queue('start_agent', { name: a.name })}>
                        {t('connect.nodeStart')}
                      </Button>
                    )}
                    <button
                      onClick={() => queue('remove_agent', { name: a.name })}
                      disabled={busy}
                      className="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                      title={t('connect.remove')}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add-agent gallery — pick an agent type to run on a node
// ---------------------------------------------------------------------------

/** Derive the per-type detection status shown as a badge in the gallery. */
function runtimeStatus(rt: import('@/lib/types').NodeRuntime | undefined) {
  if (!rt) return 'unknown' as const;
  if (rt.installed && rt.ready) return 'ready' as const;
  if (rt.installed && !rt.ready) return 'needs_login' as const;
  return 'not_installed' as const;
}

function AddAgentGallery({
  node,
  catalog,
  onBack,
  onChanged,
}: {
  node: WorkspaceNode;
  catalog: AgentCatalogEntry[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [workingDir, setWorkingDir] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [showCreds, setShowCreds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const runtimeByType = useMemo(() => {
    const m: Record<string, import('@/lib/types').NodeRuntime> = {};
    for (const r of node.runtimes || []) m[r.type] = r;
    return m;
  }, [node.runtimes]);

  const selectedEntry = catalog.find((e) => e.name === selected);
  const selectedStatus = runtimeStatus(selected ? runtimeByType[selected] : undefined);

  const pick = (typeName: string) => {
    setSelected(typeName);
    setName(typeName);
    setApiKey('');
    setModel('');
    setShowCreds(runtimeStatus(runtimeByType[typeName]) === 'needs_login');
  };

  const reDetect = async () => {
    setDetecting(true);
    try {
      await workspaceApi.enqueueNodeCommand(node.nodeId, 'detect_runtimes', {});
      toast.success(t('connect.nodeDetectQueued'));
      setTimeout(onChanged, 4000);
    } catch {
      toast.error(t('connect.nodeCommandFailed'));
    } finally {
      setDetecting(false);
    }
  };

  const create = async () => {
    const n = name.trim();
    if (!n || !selected) return;
    setBusy(true);
    try {
      await workspaceApi.enqueueNodeCommand(node.nodeId, 'create_agent', {
        name: n,
        type: selected,
        ...(workingDir.trim() ? { workingDir: workingDir.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      toast.success(t('connect.nodeCommandQueued', { node: node.name }));
      setTimeout(onChanged, 3000);
      onBack();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(/40[13]/.test(msg) ? t('connect.nodeCommandForbidden') : t('connect.nodeCommandFailed'));
    } finally {
      setBusy(false);
    }
  };

  const badge = (status: ReturnType<typeof runtimeStatus>) => {
    const map = {
      ready: { label: t('connect.nodeRuntimeReady'), cls: 'bg-green-500/10 text-green-600 dark:text-green-400' },
      needs_login: { label: t('connect.nodeRuntimeNeedsLogin'), cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-500' },
      not_installed: { label: t('connect.nodeRuntimeWillInstall'), cls: 'bg-zinc-500/10 text-muted-foreground' },
      unknown: { label: '', cls: '' },
    } as const;
    const b = map[status];
    if (!b.label) return null;
    return <span className={cn('text-[9px] font-medium px-1.5 py-0.5 rounded-full', b.cls)}>{b.label}</span>;
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <button
          onClick={onBack}
          className="shrink-0 size-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={t('connect.nodeBack')}
        >
          <ChevronRight className="size-4 rotate-180" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{t('connect.nodeAddAgentTitle', { node: node.name })}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t('connect.nodeGallerySubtitle')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={reDetect} disabled={detecting}>
          <RefreshCw className={cn('size-3.5 mr-1', detecting && 'animate-spin')} />
          {detecting ? t('connect.nodeDetecting') : t('connect.nodeReDetect')}
        </Button>
      </div>

      {/* Agent-type gallery */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {catalog.map((entry) => {
          const status = runtimeStatus(runtimeByType[entry.name]);
          const isSelected = selected === entry.name;
          return (
            <button
              key={entry.name}
              onClick={() => pick(entry.name)}
              className={cn(
                'flex flex-col gap-1.5 p-3 rounded-lg border text-left transition-all',
                isSelected
                  ? 'border-foreground/20 bg-zinc-50 dark:bg-zinc-800/50 ring-1 ring-foreground/10'
                  : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30',
              )}
            >
              <div className="flex items-center gap-2">
                <AgentIcon name={entry.name} size={24} />
                <span className="text-[13px] font-medium leading-tight truncate flex-1">{entry.label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground line-clamp-2 min-h-[26px]">{entry.description}</p>
              <div className="flex items-center justify-between">
                {badge(status) || <span />}
                {entry.homepage && (
                  <a
                    href={entry.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[9px] text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-0.5"
                  >
                    {t('connect.nodeHowTo')}<ExternalLink className="size-2.5" />
                  </a>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Config panel */}
      {!selectedEntry ? (
        <div className="rounded-lg border border-dashed py-8 px-4 text-center">
          <div className="text-xs font-medium">{t('connect.nodeSelectTypeTitle')}</div>
          <p className="text-[11px] text-muted-foreground mt-1">{t('connect.nodeSelectTypeBody')}</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-zinc-50/50 dark:bg-zinc-900/50 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2.5">
            <AgentIcon name={selectedEntry.name} size={28} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{selectedEntry.label}</div>
              <div className="text-[10px] text-muted-foreground">
                {selectedStatus === 'ready' && t('connect.nodeReadyHint')}
                {selectedStatus === 'needs_login' && t('connect.nodeNeedsLoginHint')}
                {selectedStatus === 'not_installed' && t('connect.nodeWillInstallHint')}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{t('connect.nodeAddAgent')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('connect.nodeAgentNamePlaceholder')} className="h-8 text-xs" />
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{t('connect.nodeWorkingDir')}</Label>
            <Input value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} placeholder={t('connect.nodeWorkingDirPlaceholder')} className="h-8 text-xs font-mono" />
            <p className="text-[10px] text-muted-foreground">{t('connect.nodeWorkingDirHint')}</p>
          </div>

          {!showCreds ? (
            <button onClick={() => setShowCreds(true)} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Key className="size-3" />{t('connect.nodeCredsOptional')}
            </button>
          ) : (
            <div className="space-y-2">
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={t('connect.nodeAgentKeyOptional')} type="password" className="h-8 text-xs" />
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('connect.nodeAgentModelOptional')} className="h-8 text-xs" />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={onBack} disabled={busy}>{t('connect.nodeCancel')}</Button>
            <Button size="sm" variant="primary" onClick={create} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Plus className="size-3.5 mr-1" />}
              {t('connect.nodeCreateAgent')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NodesTab({
  nodes,
  catalog,
  loading,
  pairing,
  pairingLoading,
  onGenerate,
  onDismissPairing,
  onRefresh,
}: {
  nodes: WorkspaceNode[];
  catalog: AgentCatalogEntry[];
  loading: boolean;
  pairing: PairingCode | null;
  pairingLoading: boolean;
  onGenerate: () => void;
  onDismissPairing: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  const [addingNodeId, setAddingNodeId] = useState<string | null>(null);

  // The gallery works on live node data (runtimes refresh via polling), so look
  // the node up by id each render rather than snapshotting it.
  const addingNode = addingNodeId ? nodes.find((n) => n.nodeId === addingNodeId) : null;
  if (addingNode) {
    return (
      <AddAgentGallery
        node={addingNode}
        catalog={catalog}
        onBack={() => setAddingNodeId(null)}
        onChanged={onRefresh}
      />
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Heading + refresh */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('connect.nodeHeading')}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t('connect.nodeSubtitle')}</p>
        </div>
        <button
          onClick={onRefresh}
          className="shrink-0 size-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={t('connect.nodeRefresh')}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Node list / empty state */}
      {loading && nodes.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          <span className="text-xs">{t('common.loading')}</span>
        </div>
      ) : nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 px-4 text-center">
          <div className="size-14 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <Server className="size-7 text-white" />
          </div>
          <div className="text-sm font-semibold mt-4">{t('connect.nodeEmptyTitle')}</div>
          <p className="text-[11px] text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">{t('connect.nodeEmptyBody')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.map((node) => (
            <NodeCard
              key={node.nodeId}
              node={node}
              onAddAgent={() => setAddingNodeId(node.nodeId)}
              onChanged={onRefresh}
            />
          ))}
        </div>
      )}

      {/* Pairing code panel, or the connect button */}
      {pairing ? (
        <PairingPanel pairing={pairing} onDismiss={onDismissPairing} />
      ) : nodes.length === 0 ? (
        <Button onClick={onGenerate} disabled={pairingLoading} className="w-full" variant="primary" size="lg">
          {pairingLoading ? (
            <><Loader2 className="size-4 animate-spin mr-1.5" />{t('connect.nodeGenerating')}</>
          ) : (
            <><Plus className="size-4 mr-1.5" />{t('connect.nodeConnect')}</>
          )}
        </Button>
      ) : (
        <button
          onClick={onGenerate}
          disabled={pairingLoading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-muted/40 transition-colors disabled:opacity-50"
        >
          {pairingLoading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {pairingLoading ? t('connect.nodeGenerating') : t('connect.nodeConnectAnother')}
        </button>
      )}
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
  const t = useT();
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
                  {entry.builtin ? t('connect.builtin') : entry.tags?.[0] || t('connect.openSource')}
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
                <span className="text-xs font-semibold text-foreground">{t('connect.optionA')}</span>
                <span className="text-xs text-muted-foreground">{t('connect.optionADesktop')}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                {t('connect.optionADescription')}
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
              <span className="text-[10px] text-muted-foreground">{t('connect.or')}</span>
              <div className="flex-1 border-t" />
            </div>

            {/* Option B: CLI */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-foreground">{t('connect.optionB')}</span>
                <span className="text-xs text-muted-foreground">{t('connect.optionBCli')}</span>
              </div>

              {/* Step 1: Install CLI */}
              <div className="space-y-3">
                <div>
                  <span className="text-[11px] text-muted-foreground">{t('connect.step1')}</span>
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
                  <span className="text-[11px] text-muted-foreground">{t('connect.step2', { agent: selectedEntry.label })}</span>
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
                  <span className="text-[11px] text-muted-foreground">{t('connect.step3')}</span>
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
                  <span className="text-[11px] text-muted-foreground">{t('connect.step4')}</span>
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
                  <span className="text-[11px] text-muted-foreground">{t('connect.step5')}</span>
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
                    {t('connect.step5Hint')}
                  </p>
                </div>

                {/* Step 6: Verify status */}
                <div>
                  <span className="text-[11px] text-muted-foreground">{t('connect.step6')}</span>
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
                <span className="text-xs font-medium">{t('connect.workspaceToken')}</span>
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
                  {tokenCopied ? t('common.copied') : t('common.copy')}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hint when nothing selected */}
      {!selectedEntry && (
        <p className="text-center text-xs text-muted-foreground py-4">
          {t('connect.selectAgentHint')}
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
  showBuiltinCard,
  onAddBuiltin,
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
  showBuiltinCard: boolean;
  onAddBuiltin: () => void;
}) {
  const t = useT();
  const providerGroups = [
    { label: t('connect.groupChat'), names: ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral', 'sensenova'] },
    { label: t('connect.groupSearch'), names: ['perplexity', 'manus'] },
    { label: t('connect.groupFast'), names: ['groq', 'together', 'fireworks', 'openrouter', 'sambanova', 'cerebras'] },
    { label: t('connect.groupMedia'), names: ['stability', 'replicate', 'fal', 'elevenlabs'] },
    { label: t('connect.groupCustom'), names: ['custom'] },
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
          {t('connect.allProviders')}
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
                  {isCustomProvider ? t('connect.customSubtitle') : t('connect.providerSubtitle')}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-3">
            {/* Custom endpoint: Base URL */}
            {isCustomProvider && (
              <div className="space-y-1.5">
                <Label htmlFor="cloud-base-url" className="text-xs">{t('connect.endpointUrl')}</Label>
                <Input
                  id="cloud-base-url"
                  value={cfgBaseUrl}
                  onChange={(e) => setCfgBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="text-sm font-mono h-9"
                />
                <p className="text-[10px] text-muted-foreground">{t('connect.endpointHint')}</p>
              </div>
            )}

            {/* Model selector — list for known providers, text input for custom */}
            {isCustomProvider ? (
              <div className="space-y-1.5">
                <Label htmlFor="cloud-model" className="text-xs">{t('connect.modelName')}</Label>
                <Input
                  id="cloud-model"
                  value={cfgModel}
                  onChange={(e) => setCfgModel(e.target.value)}
                  placeholder={t('connect.modelNamePlaceholder')}
                  className="text-sm font-mono h-9"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('connect.model')}</Label>
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
                  className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-lg border-2 border-input bg-background hover:bg-accent transition-colors text-sm font-medium"
                >
                  <svg viewBox="0 0 24 24" className="size-4" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {t('connect.signInWithGoogle')}
                </a>
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t" />
                  <span className="text-[10px] text-muted-foreground">{t('connect.orUseApiKey')}</span>
                  <div className="flex-1 border-t" />
                </div>
              </>
            )}

            {/* Agent name */}
            <div className="space-y-1.5">
              <Label htmlFor="cloud-name" className="text-xs">{t('connect.agentName')}</Label>
              <Input
                id="cloud-name"
                value={cfgName}
                onChange={(e) => setCfgName(e.target.value)}
                placeholder={t('connect.agentNamePlaceholder')}
                className="text-sm h-9"
              />
              <p className="text-[10px] text-muted-foreground">{t('connect.agentNameHint')}</p>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <Label htmlFor="cloud-key" className="text-xs">{t('connect.apiKey')}</Label>
              <Input
                id="cloud-key"
                type="password"
                value={cfgKey}
                onChange={(e) => setCfgKey(e.target.value)}
                placeholder={t('connect.apiKeyPlaceholder')}
                className="text-sm font-mono h-9"
              />
            </div>

            {/* Advanced */}
            <div>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAdvanced ? t('connect.hideAdvanced') : t('connect.showAdvanced')}
              </button>
              {showAdvanced && (
                <div className="mt-2">
                  <Label htmlFor="cloud-prompt" className="text-xs">{t('connect.systemPrompt')}</Label>
                  <Textarea
                    id="cloud-prompt"
                    value={cfgPrompt}
                    onChange={(e) => setCfgPrompt(e.target.value)}
                    placeholder={t('connect.systemPromptPlaceholder')}
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
      {/* Built-in Yumi — re-add the OpenAgents onboarding assistant (no API key) */}
      {showBuiltinCard && (
        <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg border border-primary/30 bg-primary/5">
          <img
            src="/yumi-avatar.png"
            alt="Yumi"
            className="size-9 shrink-0 rounded-md object-cover"
            draggable={false}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold leading-tight">{t('connect.yumiTitle')}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{t('connect.yumiSubtitle')}</div>
          </div>
          <Button
            onClick={onAddBuiltin}
            disabled={saving}
            size="sm"
            className="shrink-0"
          >
            {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
            {t('connect.yumiAdd')}
          </Button>
        </div>
      )}

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
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t('connect.connected')}</span>
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
                title={t('connect.remove')}
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
