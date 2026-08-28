'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { X, Copy, Check, ExternalLink, Loader2, Terminal, Cloud, Trash2, MessageSquare, Image as ImageIcon, Volume2, Key, ChevronRight, Server, Laptop, Monitor, RefreshCw, RotateCcw, Plus, HardDrive, Pencil, Folder, CornerLeftUp, Download, Sparkles, Search, ArrowRight, CheckCircle2, Zap, AlertTriangle } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { useWorkspace } from '@/lib/workspace-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useIsMobile } from '@/hooks/use-mobile';
import { useT, useFormatters } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import { capture } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { CAMPAIGN_PROMO_AGENT_TYPES, CampaignConnectHint, CampaignPromoAccess } from '@/components/campaign/campaign-feedback';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import type { AgentCatalogEntry, CloudAgentConfig, CloudAgentProvider, WorkspaceNode, PairingCode } from '@/lib/types';
import { AgentIcon, ProviderIcon } from '@/components/icons/agent-icons';
import { AddModelAccessDialog } from '@/components/settings/model-access-dialog';
import dynamic from 'next/dynamic';

// The welcome film is ~2k lines of scene choreography only first-run users
// ever see — load it on demand so the connect view's bundle stays lean.
const WelcomeFilm = dynamic(() => import('./welcome-film'), { ssr: false });

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
  deepseek:  { bg: 'bg-blue-700',    text: 'text-white' },
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

export function ConnectAgentView({
  initialTab = 'node',
  autoPair = false,
  autoAddAgent = false,
}: {
  initialTab?: 'local' | 'cloud' | 'node';
  autoPair?: boolean;
  autoAddAgent?: boolean;
} = {}) {
  const t = useT();
  const { openView } = useLayout();
  const { workspace, token, refreshWorkspace, agents, requestFirstThread } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const { idToken: oaIdToken } = useOpenAgentsAuth();

  const [activeTab, setActiveTab] = useState<'local' | 'cloud' | 'node'>(initialTab);
  const [loading, setLoading] = useState(true);

  // Onboarding checkpoint: the user reached the agent-setup surface. One event
  // per tab so the funnel can split node vs cloud vs local paths.
  useEffect(() => {
    capture('connect_agent_viewed', { tab: activeTab });
  }, [activeTab]);

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
        // Display/provision value only — the backend resolves the built-in
        // Yumi's actual model from server config at call time.
        model: 'minimax-m2.5',
        apiKey: '',
      });
      toast.success(t('connect.yumiAdded'));
      capture('cloud_agent_created', { provider: 'openagents', agent: 'yumi', builtin: true });
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
      capture('cloud_agent_created', { provider: selectedProvider, model: cfgModel });
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

  // Snapshot of node ids taken when a pairing code is generated, so we can tell
  // when a *new* node connects and auto-dismiss the pairing panel.
  const pairingBaselineRef = useRef<Set<string>>(new Set());

  // Load nodes when the tab is opened, then poll for live status while it's
  // visible. Poll faster (3s) while a pairing code is up so a freshly connected
  // node is detected almost immediately — the "we're watching" feel.
  useEffect(() => {
    if (activeTab !== 'node') return;
    loadNodes(true);
    const id = setInterval(() => loadNodes(false), pairing ? 3000 : 10000);
    return () => clearInterval(id);
  }, [activeTab, loadNodes, pairing]);

  // When a node appears that wasn't there when the code was generated, the pair
  // succeeded → dismiss the panel; the new node is already in the list.
  useEffect(() => {
    if (!pairing) return;
    if (nodes.some((n) => !pairingBaselineRef.current.has(n.nodeId))) {
      setPairing(null);
      toast.success(t('connect.nodeConnectedToast'));
      capture('node_connected', { source: 'workspace_ui' });
    }
  }, [nodes, pairing, t]);

  const handleGeneratePairingCode = async () => {
    setPairingLoading(true);
    try {
      const code = await workspaceApi.createPairingCode();
      pairingBaselineRef.current = new Set(nodes.map((n) => n.nodeId));
      setPairing(code);
      capture('pairing_code_generated', { source: 'node_tab' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(/40[13]/.test(msg) ? t('connect.nodePairingForbidden') : t('connect.nodePairingFailed'));
    } finally {
      setPairingLoading(false);
    }
  };

  // Guided onboarding: when asked to auto-pair, generate a code as soon as the
  // node view is ready and there are no nodes yet — so the user lands straight
  // on the pairing code instead of an empty state + a button. Fires once.
  const autoPairedRef = useRef(false);
  useEffect(() => {
    if (!autoPair || autoPairedRef.current) return;
    if (activeTab !== 'node' || loading || nodesLoading) return;
    if (nodes.length > 0 || pairing || pairingLoading) return;
    autoPairedRef.current = true;
    handleGeneratePairingCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPair, activeTab, loading, nodesLoading, nodes.length, pairing, pairingLoading]);

  const handleDismissPairing = () => {
    setPairing(null);
    loadNodes(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header — title in the app header, actions in its toolbar */}
      <DetailHeader title={<h2 className="text-base font-semibold">{t('connect.title')}</h2>}>
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
      <div className="px-6 pt-4 pb-2 shrink-0">
        <div className="flex gap-1.5 p-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/60 max-w-2xl mx-auto w-full">
          {([
            { id: 'node', icon: Server, label: t('connect.tabNode') },
            { id: 'cloud', icon: Cloud, label: t('connect.tabCloud') },
            // Manual connection is being retired — kept last, with a notice.
            { id: 'local', icon: Terminal, label: t('connect.tabLocal') },
          ] as const).map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all',
                  active
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className={cn('size-4', active && 'text-primary')} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Credits-campaign incentive — Local Agents tab only: the milestone is
          about launcher/CLI agents, so it would only confuse on the Cloud
          Agents and Manual Connection tabs. */}
      {activeTab === 'node' && <CampaignConnectHint idToken={oaIdToken} />}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
            <span className="text-xs">{t('common.loading')}</span>
          </div>
        ) : activeTab === 'local' ? (
          <div>
            {/* Retirement notice — manual connection is on its way out. */}
            <div className="mx-auto max-w-2xl px-6 pt-5">
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3">
                <Terminal className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{t('connect.manualRetireTitle')}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{t('connect.manualRetireBody')}</p>
                </div>
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => setActiveTab('node')}>
                  {t('connect.manualRetireCta')}
                </Button>
              </div>
            </div>
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
          </div>
        ) : activeTab === 'node' ? (
          <NodesTab
            nodes={nodes}
            catalog={catalog}
            cloudProviders={cloudProviders}
            autoAddAgent={autoAddAgent}
            onFirstAgentCreated={requestFirstThread}
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

// Marketplace "Popular agents" section, in display order (confirmed 2026-08-27).
const MARKET_POPULAR_AGENTS = [
  'claude', 'openclaw', 'codex', 'cursor', 'opencode', 'hermes', 'pi', 'kimi', 'deepseek',
];

const INSTALL_COMMAND = 'curl -fsSL https://openagents.org/install.sh | bash';
const INSTALL_COMMAND_WIN = 'irm https://openagents.org/install.ps1 | iex';

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

/** One numbered step in the pairing walkthrough, with a connector rail. */
function PairingStep({
  n,
  title,
  last = false,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">
          {n}
        </span>
        {!last && <span className="mt-1.5 w-px flex-1 bg-border" />}
      </div>
      <div className={cn('min-w-0 flex-1', !last && 'pb-6')}>
        <div className="text-sm font-semibold leading-6">{title}</div>
        <div className="mt-2.5 space-y-2.5">{children}</div>
      </div>
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
  const isMobile = useIsMobile();
  const [codeCopied, setCodeCopied] = useState(false);
  const [os, setOs] = useState<'unix' | 'windows'>(() =>
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent) ? 'windows' : 'unix',
  );
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
      <div className="px-5 py-3.5 border-b flex items-center justify-between">
        <span className="text-sm font-semibold">{t('connect.nodePairingTitle')}</span>
        <span className={cn(
          'text-[11px] font-medium rounded-full px-2.5 py-1',
          expired ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-600 dark:text-amber-500',
        )}>
          {expired ? t('connect.nodePairingExpired') : t('connect.nodePairingExpires', { minutes })}
        </span>
      </div>

      <div className="p-5">
        {/* Step 1 — get the launcher (desktop app or CLI). On a phone the
            download links are dead ends (the launcher runs on a computer),
            so point at the laptop instead and keep the CLI path for servers. */}
        <PairingStep n={1} title={isMobile ? t('connect.nodeMobileStep1Title') : t('connect.nodeStep1Title')}>
          {isMobile && (
            <div className="rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3.5 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Laptop className="size-4 shrink-0 text-primary" />
                <span>
                  {t('connect.nodeMobileGoTo1')}{' '}
                  <span className="font-mono font-bold text-primary">openagents.org</span>{' '}
                  {t('connect.nodeMobileGoTo2')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t('connect.nodeMobileTime')}</p>
            </div>
          )}
          <div className={cn('text-xs font-medium text-muted-foreground', isMobile && 'hidden')}>{t('connect.nodeInstallDesktop')}</div>
          <div className={cn('grid grid-cols-3 gap-2', isMobile && 'hidden')}>
            {([
              { os: t('connect.nodeMacSilicon'), href: 'https://openagents.org/api/download/launcher/mac' },
              { os: t('connect.nodeMacIntel'), href: 'https://openagents.org/api/download/launcher/mac-intel' },
              { os: 'Windows', href: 'https://openagents.org/api/download/launcher/windows' },
            ]).map((d) => (
              <a
                key={d.os}
                href={d.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border hover:border-primary/40 hover:bg-primary/[0.03] transition-colors"
              >
                <Download className="size-3.5" />{d.os}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3 py-0.5">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('connect.nodeStepOr')}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">{t('connect.nodeInstallCli')}</div>
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted">
              {([
                { id: 'unix', label: t('connect.nodeOsUnix') },
                { id: 'windows', label: t('connect.nodeOsWindows') },
              ] as const).map((o) => (
                <button
                  key={o.id}
                  onClick={() => setOs(o.id)}
                  className={cn(
                    'px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
                    os === o.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <CommandRow command={os === 'windows' ? INSTALL_COMMAND_WIN : INSTALL_COMMAND} />
        </PairingStep>

        {/* Step 2 — enter the pairing code */}
        <PairingStep n={2} title={t('connect.nodeStep2Title')}>
          <button
            onClick={copyCode}
            disabled={expired}
            className={cn(
              'group w-full flex items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-6 transition-colors',
              expired
                ? 'opacity-50 cursor-not-allowed border-zinc-200 dark:border-zinc-800'
                : 'border-primary/25 bg-gradient-to-b from-primary/[0.04] to-transparent hover:from-primary/[0.08]',
            )}
            title={t('connect.nodeCopyCode')}
          >
            <span className="text-[2.25rem] leading-none font-mono font-bold tracking-[0.25em] tabular-nums">{pairing.code}</span>
            {codeCopied
              ? <Check className="size-6 text-green-500" />
              : <Copy className="size-6 text-muted-foreground group-hover:text-foreground transition-colors" />}
          </button>
          <p className="text-[11px] text-muted-foreground">{t('connect.nodeStep2Hint')}</p>
          {isMobile && (
            <p className="text-[11px] text-muted-foreground">{t('connect.nodeMobileCodeHint')}</p>
          )}
        </PairingStep>

        {/* Step 3 — live "waiting for the device" indicator; auto-closes when a
            node connects (the parent watches the node list and dismisses this). */}
        <PairingStep n={3} title={t('connect.nodeStep3Title')} last>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="relative flex size-5 shrink-0 items-center justify-center">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40" />
                <Loader2 className="size-5 animate-spin text-primary" />
              </span>
              <span className="text-xs font-medium truncate">{t('connect.nodeWaiting')}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={onDismiss}>{t('connect.nodeCancel')}</Button>
          </div>
        </PairingStep>
      </div>
    </div>
  );
}

/** Optimistic Add-agent placeholder, optionally tied to its create command. */
interface PendingAgent {
  name: string;
  type: string;
  at: number;
  commandId?: string;
  cmdStatus?: 'pending' | 'running' | 'done' | 'error';
  cmdMessage?: string | null;
}

function NodeCard({
  node,
  pending = [],
  defaultExpanded = false,
  onAddAgent,
  onEditAgent,
  onChanged,
}: {
  node: WorkspaceNode;
  pending?: PendingAgent[];
  defaultExpanded?: boolean;
  onAddAgent: () => void;
  onEditAgent: (agent: import('@/lib/types').NodeAgent) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { timeAgo } = useFormatters();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [busy, setBusy] = useState(false);

  const online = node.status === 'online';
  const agents = node.agents || [];
  // Optimistic placeholders for agents being created but not yet reported in the
  // roster, so the user sees them spinning up immediately.
  const pendingAgents = pending.filter((p) => !agents.some((a) => a.name === p.name));

  // Reveal the roster when something is spinning up, so the placeholder is seen.
  useEffect(() => {
    if (pendingAgents.length > 0) setExpanded(true);
  }, [pendingAgents.length]);

  // A placeholder that outlives any realistic spin-up isn't "starting" — the
  // agent failed to come up or lost its workspace binding on the device (e.g.
  // the node was re-paired mid-create and the old credential was revoked).
  // Flip the endless spinner into a warning so the user gets an actionable
  // state instead of waiting forever. The tick re-renders while placeholders
  // exist so the flip happens without any user interaction.
  const PENDING_STALL_MS = 120_000;
  const [, setPendingTick] = useState(0);
  useEffect(() => {
    if (pendingAgents.length === 0) return;
    const id = setInterval(() => setPendingTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [pendingAgents.length]);
  // While the create command is still pending/running on the device the
  // spinner is TRUE state, not a guess — a queued npm install of a large
  // runtime takes minutes and must never read as "not up yet".
  const isInFlight = (p: PendingAgent) =>
    !!p.commandId && p.cmdStatus !== 'done' && p.cmdStatus !== 'error';
  const isFailed = (p: PendingAgent) => p.cmdStatus === 'error';
  const isStalled = (p: PendingAgent) =>
    !isInFlight(p) && !isFailed(p) &&
    typeof p.at === 'number' && Date.now() - p.at > PENDING_STALL_MS;
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
      <div className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-3.5 text-left"
        >
          <div className={cn('size-12 shrink-0 flex items-center justify-center rounded-2xl text-white shadow-sm', deviceTile(node.deviceType))}>
            {deviceIcon(node.deviceType, 'size-6')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold truncate">{node.name}</span>
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
              'flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1',
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
          className="shrink-0 size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
        >
          <Trash2 className="size-4" />
        </button>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Toggle details"
        >
          <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
        </button>
      </div>

      {/* Expanded: agent roster + management */}
      {expanded && (
        <div className="border-t px-3 py-3 space-y-3 bg-zinc-50/40 dark:bg-zinc-900/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground">{t('connect.nodeAgents')}</span>
            {(agents.length > 0 || pendingAgents.length > 0) && (
              <Button size="sm" variant="outline" onClick={onAddAgent}>
                <Plus className="size-3.5 mr-1" />{t('connect.nodeAddAgent')}
              </Button>
            )}
          </div>

          {!online && (
            <p className="text-[10px] text-amber-600 dark:text-amber-500">{t('connect.nodeOfflineActionHint')}</p>
          )}

          {/* Roster */}
          {agents.length === 0 && pendingAgents.length === 0 ? (
            <div className="flex flex-col items-center text-center py-6 gap-3">
              <p className="text-[11px] text-muted-foreground">{t('connect.nodeNoAgents')}</p>
              <Button variant="primary" size="lg" onClick={onAddAgent} className="min-w-[200px]">
                <Plus className="size-4 mr-1.5" />{t('connect.nodeAddAgent')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Pending: agents being spun up, not yet in the roster */}
              {pendingAgents.map((p) => {
                const failed = isFailed(p);
                const installing = isInFlight(p);
                const stalled = isStalled(p);
                const chip = failed
                  ? { cls: 'bg-red-500/10 text-red-600 dark:text-red-400', icon: <AlertTriangle className="size-2.5" />, text: t('connect.nodeAgentFailed') }
                  : stalled
                    ? { cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-500', icon: <AlertTriangle className="size-2.5" />, text: t('connect.nodeAgentStalled') }
                    : installing
                      ? { cls: 'bg-primary/10 text-primary', icon: <Loader2 className="size-2.5 animate-spin" />, text: t('connect.nodeAgentInstalling') }
                      : { cls: 'bg-primary/10 text-primary', icon: <Loader2 className="size-2.5 animate-spin" />, text: t('connect.nodeAgentStarting') };
                return (
                <div key={`pending-${p.name}`} className="rounded-lg border border-dashed bg-muted/30 p-3 flex flex-col gap-2 animate-in fade-in">
                  <div className="flex items-center gap-2.5">
                    <div className="size-9 shrink-0 rounded-lg border bg-background flex items-center justify-center relative">
                      <AgentIcon name={p.type} size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate">@{p.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{p.type}</div>
                    </div>
                    <span className={cn('flex items-center gap-1 text-[9px] font-medium rounded-full px-1.5 py-0.5 shrink-0', chip.cls)}>
                      {chip.icon}
                      {chip.text}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t border-dashed">
                    {failed ? (
                      <span className="text-[10px] text-red-600 dark:text-red-400">
                        {p.cmdMessage || t('connect.nodeAgentFailedHint')}
                      </span>
                    ) : stalled ? (
                      <span className="text-[10px] text-amber-600 dark:text-amber-500">{t('connect.nodeAgentStalledHint')}</span>
                    ) : (
                      <>
                        <span className="relative flex size-2 items-center justify-center">
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/40" />
                          <span className="size-1.5 rounded-full bg-primary" />
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {installing ? t('connect.nodeAgentInstallingHint') : t('connect.nodeAgentSpinningUp')}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                );
              })}
              {agents.map((a) => {
                const running = a.status === 'running';
                return (
                  <div key={a.name} className="rounded-lg border bg-background p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="size-9 shrink-0 rounded-lg border bg-background flex items-center justify-center">
                        <AgentIcon name={a.type} size={22} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold truncate">@{a.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{a.type}</div>
                      </div>
                      <span className={cn(
                        'flex items-center gap-1 text-[9px] font-medium rounded-full px-1.5 py-0.5 shrink-0',
                        running ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-zinc-500/10 text-muted-foreground',
                      )}>
                        <span className={cn('size-1.5 rounded-full', running ? 'bg-green-500' : 'bg-zinc-400')} />
                        {running ? t('connect.nodeAgentStatusRunning') : t('connect.nodeAgentStatusStopped')}
                      </span>
                    </div>

                    {/* Model line */}
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className="font-medium text-foreground/70">{t('connect.nodeModelDefault')}:</span>
                      <span className="font-mono truncate">{a.model || t('connect.nodeModelAutoShort')}</span>
                    </div>

                    {/* Failing smoke test — the agent will likely not answer */}
                    {a.probe && a.probe.ok === false && a.probe.code !== 'static_only' && (
                      <div className="flex items-start gap-1.5 text-[10px] text-red-600 dark:text-red-400">
                        <X className="size-3 mt-px shrink-0" />
                        <span className="break-words">{a.probe.message || t('connect.smokeTestFailed')}</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1 pt-1 border-t">
                      {running ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => queue('stop_agent', { name: a.name })}>
                          {t('connect.nodeStop')}
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => queue('start_agent', { name: a.name })}>
                          {t('connect.nodeStart')}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onEditAgent(a)}>
                        <Pencil className="size-3.5 mr-1" />{t('connect.nodeEdit')}
                      </Button>
                      <span className="flex-1" />
                      <button
                        onClick={() => queue('remove_agent', { name: a.name })}
                        disabled={busy}
                        className="size-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                        title={t('connect.remove')}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
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

/**
 * Smoke-test panel: the last live "hi"-probe result the daemon reported for
 * this AGENT on this node (probes are per agent — run after create and
 * reconfigure, then hourly), plus a button to run it again (queues a
 * `probe_agent` node command; the fresh result arrives via the heartbeat's
 * agents[].probe on the next poll).
 */
function SmokeTestPanel({ nodeId, agentName, probe, onChanged }: {
  nodeId: string;
  agentName: string;
  probe: import('@/lib/types').NodeProbe | null | undefined;
  onChanged: () => void;
}) {
  const t = useT();
  const [testing, setTesting] = useState(false);
  // Stop the spinner as soon as a fresh result lands (its timestamp changes).
  const lastAt = useRef(probe?.at);
  useEffect(() => {
    if (probe?.at !== lastAt.current) {
      lastAt.current = probe?.at;
      setTesting(false);
    }
  }, [probe?.at]);

  // Static-only results say nothing about liveness — treat as untested.
  const informative = probe && probe.code !== 'static_only' ? probe : null;

  const run = async () => {
    setTesting(true);
    try {
      await workspaceApi.enqueueNodeCommand(nodeId, 'probe_agent', { name: agentName });
      // Nudge the node poll a few times while the probe runs on the device;
      // a probe can take up to its CLI timeout, so keep the spinner bounded.
      setTimeout(onChanged, 8000);
      setTimeout(onChanged, 20000);
      setTimeout(onChanged, 45000);
      setTimeout(() => setTesting(false), 150000);
    } catch {
      toast.error(t('connect.nodeCommandFailed'));
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 text-xs">
          <span className="font-medium shrink-0">{t('connect.smokeTestTitle')}</span>
          {testing ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />{t('connect.smokeTestRunning')}
            </span>
          ) : informative ? (
            <span className={cn(
              'inline-flex items-center gap-1.5 min-w-0',
              informative.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
            )}>
              {informative.ok ? <Check className="size-3 shrink-0" /> : <X className="size-3 shrink-0" />}
              {informative.ok ? t('connect.smokeTestPassed') : t('connect.smokeTestFailed')}
              <span className="text-muted-foreground truncate">
                {t('connect.smokeTestAt', { time: new Date(informative.at).toLocaleString() })}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t('connect.smokeTestNever')}</span>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px] shrink-0" onClick={run} disabled={testing}>
          {informative ? t('connect.smokeTestRerun') : t('connect.smokeTestRun')}
        </Button>
      </div>
      {!testing && informative && !informative.ok && (
        <div className="space-y-1.5">
          {informative.message && (
            <p className="text-[11px] text-red-600/90 dark:text-red-400/90 break-words">{informative.message}</p>
          )}
          {(informative.guidance || []).length > 0 && (
            <ul className="space-y-1">
              {(informative.guidance || []).map((line, i) => (
                <li key={i} className="text-[11px] text-muted-foreground leading-relaxed flex gap-1.5">
                  <ArrowRight className="size-3 mt-0.5 shrink-0" />
                  <span className="break-words">{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Marketplace building blocks (Add-agent gallery) ─────────────────────────
// The gallery reads as a storefront: featured spotlight, search + category
// chips, vendor + status-dot cards. The app's `primary` token is near-black,
// so the marketplace carries its own indigo accent in both themes.

type GalleryStatus = ReturnType<typeof runtimeStatus>;

/** Logo chip on a white surface so dark agent marks stay legible in dark mode. */
function MarketLogo({ name, size, className }: { name: string; size: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10 shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <AgentIcon name={name} size={Math.round(size * 0.55)} />
    </span>
  );
}

function marketStatusMeta(t: ReturnType<typeof useT>, status: GalleryStatus) {
  switch (status) {
    case 'ready':
      return { label: t('connect.nodeRuntimeReady'), dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' };
    case 'needs_login':
      return { label: t('connect.nodeRuntimeNeedsLogin'), dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-500' };
    default:
      return { label: t('connect.nodeRuntimeWillInstall'), dot: 'bg-zinc-400', text: 'text-muted-foreground' };
  }
}

function MarketStatusBadge({ status, checking, className }: { status: GalleryStatus; checking?: boolean; className?: string }) {
  const t = useT();
  if (checking) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[10.5px] font-medium text-primary whitespace-nowrap', className)}>
        <Loader2 className="size-2.5 animate-spin" />{t('connect.nodeChecking')}
      </span>
    );
  }
  const meta = marketStatusMeta(t, status);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[10.5px] font-medium whitespace-nowrap', meta.text, className)}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

/** Rotating featured spotlight above the marketplace grid. */
function MarketHero({ slides, statusOf, checkingOf, onPick }: {
  slides: AgentCatalogEntry[];
  statusOf: (name: string) => GalleryStatus;
  checkingOf: (name: string) => boolean;
  onPick: (name: string) => void;
}) {
  const t = useT();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => setI((v) => (v + 1) % slides.length), 6000);
    return () => clearInterval(timer);
  }, [slides.length]);
  const a = slides[i % slides.length];
  if (!a) return null;
  const status = statusOf(a.name);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-indigo-500/25 bg-gradient-to-r from-indigo-500/[0.09] via-violet-500/[0.05] to-transparent dark:from-indigo-400/[0.12] dark:via-violet-400/[0.05]">
      <div className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 right-0 size-72 rounded-full bg-violet-500/15 blur-3xl" />

      <div key={a.name} className="relative flex items-center gap-5 px-5 py-5 sm:px-7 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <MarketLogo name={a.name} size={76} className="rounded-2xl shadow-md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">
            <Sparkles className="size-3" /> {t('connect.marketFeatured')}
          </div>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight truncate">{a.label}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground max-w-lg line-clamp-2">{a.tagline || a.description}</p>
          <div className="mt-2.5 flex items-center gap-3">
            <button
              onClick={() => onPick(a.name)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-600/25 hover:bg-indigo-500 transition-colors"
            >
              <Plus className="size-3.5" /> {t('connect.marketAddToDevice')}
            </button>
            <MarketStatusBadge status={status} checking={checkingOf(a.name)} className="hidden sm:inline-flex" />
          </div>
        </div>
        <div className="hidden lg:flex flex-col gap-1.5 w-44 shrink-0">
          {[
            [t('connect.marketVendor'), a.vendor || '—'],
            [t('connect.marketRuntime'), t('connect.marketRuntimeValue')],
            [t('connect.marketOnDevice'), marketStatusMeta(t, status).label],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-background/70 backdrop-blur-sm ring-1 ring-border/60 px-3 py-1.5">
              <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">{k}</div>
              <div className="text-[11.5px] font-medium truncate">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex items-center gap-1.5 px-5 sm:px-7 pb-3.5">
        {slides.map((s, idx) => (
          <button
            key={s.name}
            onClick={() => setI(idx)}
            aria-label={s.label}
            className={cn(
              'h-1.5 rounded-full transition-all duration-300',
              idx === i % slides.length ? 'w-6 bg-indigo-500' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60',
            )}
          />
        ))}
      </div>
    </div>
  );
}

// Model options come from GET /v1/agent-catalog/{type} — the registry resolves
// each agent's supported models server-side, so the dropdown is always current
// with no per-type mapping in the client. Agents whose detail returns an empty
// model list use their own login/default and show no model field. Cached per
// type for the page's lifetime (the list only changes on backend deploys).
const agentDetailCache = new Map<string, import('@/lib/types').AgentCatalogDetail | null>();

/**
 * Browse folders on the *node's* filesystem to pick a working directory. The
 * home level shows instantly from the node's heartbeat snapshot; drilling
 * deeper runs a list_dir command on the device (a short wait).
 */
function FolderPicker({
  node,
  onPick,
  onClose,
}: {
  node: WorkspaceNode;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const home = node.fs?.home || null;
  const [path, setPath] = useState<string | null>(home);
  const [dirs, setDirs] = useState<string[]>(node.fs?.dirs || []);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(!home);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const join = (base: string, name: string) => (base.endsWith('/') ? base + name : `${base}/${name}`);

  const browse = async (target: string) => {
    setLoading(true);
    try {
      const cmd = await workspaceApi.enqueueNodeCommand(node.nodeId, 'list_dir', { path: target });
      for (let i = 0; i < 20 && !cancelled.current; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const cmds = await workspaceApi.listNodeCommands(node.nodeId).catch(() => []);
        const c = cmds.find((x) => x.commandId === cmd.commandId);
        if (c && (c.status === 'done' || c.status === 'error')) {
          if (cancelled.current) return;
          const data = c.result?.data as { path: string; parent: string | null; dirs: string[] } | undefined;
          if (c.status === 'done' && data) {
            setPath(data.path); setDirs(data.dirs || []); setParent(data.parent); setUnavailable(false);
          } else {
            setUnavailable(true);
          }
          setLoading(false);
          return;
        }
      }
      if (!cancelled.current) setLoading(false);
    } catch {
      if (!cancelled.current) { setLoading(false); setUnavailable(true); }
    }
  };

  return (
    <div className="rounded-xl border bg-background overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2 bg-muted/40">
        <span className="text-[11px] font-medium truncate">{t('connect.nodePickerTitle')}</span>
        <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
      </div>

      {/* Current path */}
      <div className="px-3 py-2 border-b bg-zinc-950 dark:bg-black">
        <code className="text-[11px] font-mono text-zinc-100 break-all">{path || '—'}</code>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /><span className="text-xs">{t('connect.nodePickerLoading')}</span>
          </div>
        ) : unavailable ? (
          <p className="text-[11px] text-muted-foreground px-3 py-6 text-center">{t('connect.nodePickerUnavailable')}</p>
        ) : (
          <div className="py-1">
            {parent && (
              <button
                onClick={() => browse(parent)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60 transition-colors"
              >
                <CornerLeftUp className="size-4 text-muted-foreground" />{t('connect.nodePickerUp')}
              </button>
            )}
            {dirs.length === 0 && !parent ? (
              <p className="text-[11px] text-muted-foreground px-3 py-6 text-center">{t('connect.nodePickerEmpty')}</p>
            ) : (
              dirs.map((d) => (
                <button
                  key={d}
                  onClick={() => path && browse(join(path, d))}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60 transition-colors"
                >
                  <Folder className="size-4 text-blue-500" /><span className="truncate">{d}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>{t('connect.nodeCancel')}</Button>
        <Button size="sm" variant="primary" disabled={!path} onClick={() => { if (path) { onPick(path); onClose(); } }}>
          {t('connect.nodePickerUseThis')}
        </Button>
      </div>
    </div>
  );
}

function AddAgentGallery({
  node,
  catalog,
  cloudProviders,
  editAgent,
  onBack,
  onChanged,
  onQueued,
}: {
  node: WorkspaceNode;
  catalog: AgentCatalogEntry[];
  cloudProviders: CloudAgentProvider[];
  editAgent?: import('@/lib/types').NodeAgent;
  onBack: () => void;
  onChanged: () => void;
  onQueued?: (agent: { name: string; type: string; commandId?: string }) => void;
}) {
  const t = useT();
  const isEdit = !!editAgent;
  const [selected, setSelected] = useState<string | null>(editAgent?.type ?? null);
  const [name, setName] = useState(editAgent?.name ?? '');
  // Once the user edits the name, picking/switching a type must never overwrite
  // it — otherwise a typed name like "claudecbd" silently reverts to the type
  // ("claude"). The type only seeds the name as a convenience default.
  const nameTouched = useRef(false);
  const [workingDir, setWorkingDir] = useState(editAgent?.workingDir ?? '');
  const [apiKey, setApiKey] = useState('');
  // Custom OpenAI/Anthropic-compatible endpoint. Without this field a key was
  // only usable against an agent's built-in providers — for hermes (whose key
  // is meaningless without an endpoint) the form was a dead end. The daemon's
  // create/configure commands have always accepted baseUrl; the form just
  // never sent it.
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState(editAgent?.model ?? '');
  // When editing an agent that has a key on the node, open the credentials
  // section up front so the masked key (and the keep-if-blank rule) is visible
  // — otherwise the collapsed section reads as "no key saved".
  const [showCreds, setShowCreds] = useState(!!editAgent?.apiKeyMasked);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  // Marketplace toolbar state (selection mode).
  const [marketQuery, setMarketQuery] = useState('');
  const [marketCat, setMarketCat] = useState('all');
  // Detection is "in progress" until the node reports its runtime list — either
  // on first open (nothing reported yet) or after a Re-detect, until fresh data
  // arrives on the next heartbeat.
  const hasRuntimes = (node.runtimes || []).length > 0;
  const [detecting, setDetecting] = useState(!hasRuntimes);

  const runtimeByType = useMemo(() => {
    const m: Record<string, import('@/lib/types').NodeRuntime> = {};
    for (const r of node.runtimes || []) m[r.type] = r;
    return m;
  }, [node.runtimes]);

  // Clear "detecting" as soon as the runtime snapshot arrives or changes.
  const runtimesSig = (node.runtimes || []).map((r) => `${r.type}:${r.installed}:${r.ready}:${r.probe?.at ?? ''}`).join('|');
  const prevSigRef = useRef(runtimesSig);
  useEffect(() => {
    if (runtimesSig !== prevSigRef.current) {
      prevSigRef.current = runtimesSig;
      setDetecting(false);
    }
  }, [runtimesSig]);

  const selectedEntry = catalog.find((e) => e.name === selected);
  const selectedStatus = runtimeStatus(selected ? runtimeByType[selected] : undefined);

  const pick = (typeName: string) => {
    setSelected(typeName);
    if (!nameTouched.current) setName(typeName); // seed only while untouched
    setWorkingDir('');
    setApiKey('');
    setBaseUrl('');
    setModel('');
    setShowCreds(runtimeStatus(runtimeByType[typeName]) === 'needs_login');
    setByokAccessId('');
    resetByokChecks();
  };

  const backToSelection = () => {
    setSelected(null);
    setShowCreds(false);
  };

  // Registry detail for the selected type: fixed model list (claude/gemini/…)
  // and whether the agent is bring-your-own-provider (generic LLM_* mapping).
  const [detail, setDetail] = useState<import('@/lib/types').AgentCatalogDetail | null>(
    () => (selected ? agentDetailCache.get(selected) ?? null : null),
  );
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    if (agentDetailCache.has(selected)) { setDetail(agentDetailCache.get(selected) ?? null); return; }
    let cancelled = false;
    workspaceApi.getAgentCatalogDetail(selected)
      .then((d) => {
        agentDetailCache.set(selected, d);
        if (!cancelled) setDetail(d);
      })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [selected]);

  // Fixed model dropdown (agents tied to one provider). Exclude image/audio.
  const modelOptions = useMemo(() => {
    const models = (detail?.models || [])
      .filter((m) => m.category !== 'image' && m.category !== 'audio')
      .map((m) => ({ id: m.id, label: m.label }));
    return models.length ? models : undefined;
  }, [detail]);

  // Bring-your-own-provider agents (OpenCode, OpenClaw, Cursor, Pi…): no fixed
  // model list, but a generic LLM_* env mapping — the form offers the
  // workspace's saved Model access entries (settings → Model access), loads
  // the models that key can use, and validates live. The browser only ever
  // sends the entry id; the backend resolves the key when enqueuing.
  // Curated models and BYOK are not mutually exclusive: an agent can ship a
  // first-party model list (e.g. OpenCode Zen) AND accept any provider via
  // LLM_* mapping — so gate the Model-access section on the mapping alone.
  // provider_locked agents (Cursor) are the exception: their key field is for
  // the vendor's OWN key only, so offering provider/relay accesses just sets
  // users up for a CLI that can never authenticate.
  const byok = !!detail?.resolve_env?.rules?.length && !detail?.provider_locked;
  // Anthropic-protocol agents (Claude family) can only use Anthropic keys or
  // Anthropic-compatible relays — filter the saved accesses accordingly.
  const byokProtocol = detail?.protocol || 'openai';
  const [accesses, setAccesses] = useState<import('@/lib/types').ModelAccessEntry[] | null>(null);
  const byokAccessOptions = (accesses || []).filter((a) =>
    byokProtocol === 'anthropic'
      ? ['anthropic', 'custom-anthropic'].includes(a.provider)
      : a.provider !== 'custom-anthropic',
  );
  const [byokAccessId, setByokAccessId] = useState('');
  const [byokCustomModel, setByokCustomModel] = useState(false);
  const [showAccessDialog, setShowAccessDialog] = useState(false);
  const [byokModels, setByokModels] = useState<{ id: string; label: string }[] | null>(null);
  const [byokModelsSource, setByokModelsSource] = useState<'live' | 'catalog' | null>(null);
  const [byokLoading, setByokLoading] = useState(false);
  const [byokKeyError, setByokKeyError] = useState<string | null>(null);
  const [byokTest, setByokTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; ms?: number; error?: string }>({ state: 'idle' });

  useEffect(() => {
    if (!byok || accesses !== null) return;
    workspaceApi.listModelAccess().then(setAccesses).catch(() => setAccesses([]));
  }, [byok, accesses]);

  const resetByokChecks = () => {
    setByokModels(null); setByokModelsSource(null); setByokKeyError(null); setByokTest({ state: 'idle' });
  };

  const loadByokModels = async (accessId: string) => {
    if (!accessId) return;
    setByokLoading(true); setByokKeyError(null); setByokTest({ state: 'idle' });
    try {
      const r = await workspaceApi.probeModelAccess(accessId);
      if (r.keyOk === false) {
        setByokKeyError(r.error || t('connect.byokKeyInvalid'));
        setByokModels(null);
      } else {
        const models = (r.models || [])
          .filter((m) => m.category !== 'image' && m.category !== 'audio')
          .map((m) => ({ id: m.id, label: m.label }))
          // Providers return /models in arbitrary order — sort by name so the
          // dropdown is scannable. numeric:true keeps version numbers sane
          // (gpt-4 < gpt-5.1 < gpt-5.6, qwen-1.8b < qwen3.5).
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
        setByokModels(models);
        setByokModelsSource(r.source || 'live');
      }
    } catch (err) {
      setByokKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setByokLoading(false);
    }
  };

  const pickAccess = (accessId: string) => {
    setByokAccessId(accessId);
    setModel('');
    setByokCustomModel(false);
    resetByokChecks();
    if (accessId) loadByokModels(accessId);
  };

  const testByok = async () => {
    if (!byokAccessId || !model.trim()) return;
    setByokTest({ state: 'testing' });
    try {
      const r = await workspaceApi.probeModelAccess(byokAccessId, model.trim());
      if (r.ok) setByokTest({ state: 'ok', ms: r.latencyMs });
      else setByokTest({ state: 'fail', error: r.error });
    } catch (err) {
      setByokTest({ state: 'fail', error: err instanceof Error ? err.message : String(err) });
    }
  };

  const reDetect = async () => {
    setDetecting(true);
    try {
      await workspaceApi.enqueueNodeCommand(node.nodeId, 'detect_runtimes', {});
      setTimeout(onChanged, 4000);
      // Safety: if fresh data never arrives, stop the spinner after a while so
      // the UI doesn't look stuck.
      setTimeout(() => setDetecting(false), 20000);
    } catch {
      toast.error(t('connect.nodeCommandFailed'));
      setDetecting(false);
    }
  };

  const create = async () => {
    const n = name.trim();
    if (!n || !selected) return;
    setBusy(true);
    try {
      if (isEdit) {
        await workspaceApi.enqueueNodeCommand(node.nodeId, 'configure_agent', {
          name: n,
          type: selected,
          model: model.trim(),                       // '' clears → Auto
          currentWorkingDir: editAgent?.workingDir || '',
          ...(workingDir.trim() ? { workingDir: workingDir.trim() } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseUrl.trim() && !detail?.provider_locked ? { baseUrl: baseUrl.trim() } : {}),
          ...(byok && byokAccessId ? { modelAccessId: byokAccessId } : {}),
        });
      } else {
        const cmd = await workspaceApi.enqueueNodeCommand(node.nodeId, 'create_agent', {
          name: n,
          type: selected,
          ...(workingDir.trim() ? { workingDir: workingDir.trim() } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseUrl.trim() && !detail?.provider_locked ? { baseUrl: baseUrl.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(byok && byokAccessId ? { modelAccessId: byokAccessId } : {}),
        });
        // Optimistically show it spinning up in the node card. The commandId
        // lets the placeholder track the REAL install/config progress instead
        // of guessing from a timer.
        onQueued?.({ name: n, type: selected, commandId: cmd?.commandId });
      }
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

  // ---- Config mode: a focused, full-view form for the chosen agent ----------
  if (selectedEntry) {
    return (
      <div className="p-6 space-y-5 max-w-2xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <button
            onClick={isEdit ? onBack : backToSelection}
            className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="size-3.5 rotate-180" />{isEdit ? t('connect.nodeBack') : t('connect.nodeBackToAgents')}
          </button>
        </div>

        {/* Agent hero */}
        <div className="flex items-center gap-4">
          <div className="size-14 shrink-0 rounded-2xl border bg-muted/40 flex items-center justify-center shadow-sm">
            <AgentIcon name={selectedEntry.name} size={34} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold truncate">{selectedEntry.label}</h3>
              {badge(selectedStatus)}
              {selectedEntry.homepage && (
                <a href={selectedEntry.homepage} target="_blank" rel="noopener noreferrer"
                   className="text-muted-foreground/50 hover:text-primary transition-colors"><ExternalLink className="size-3.5" /></a>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{selectedEntry.description}</p>
          </div>
        </div>

        {/* Config card */}
        <div className="rounded-2xl border bg-background p-5 space-y-4">
          {/* Status hint */}
          <div className={cn(
            'text-xs rounded-xl px-4 py-3 leading-relaxed',
            selectedStatus === 'ready' && 'bg-green-500/10 text-green-700 dark:text-green-400',
            selectedStatus === 'needs_login' && 'bg-amber-500/10 text-amber-700 dark:text-amber-500',
            (selectedStatus === 'not_installed' || selectedStatus === 'unknown') && 'bg-muted text-muted-foreground',
          )}>
            {selectedStatus === 'ready' && t('connect.nodeReadyHint')}
            {selectedStatus === 'needs_login' && (detail?.provider_locked
              ? t('connect.nodeProviderLockedHint', { label: selectedEntry?.label || selected || '' })
              : t('connect.nodeNeedsLoginHint'))}
            {(selectedStatus === 'not_installed' || selectedStatus === 'unknown') && t('connect.nodeWillInstallHint')}
          </div>

          {/* Provider-locked agents (Cursor): the ONLY credentials that work are
              the vendor's own — spell out both paths so the key field isn't a
              guessing game, and nobody pastes an OpenAI/relay key that can
              never authenticate. */}
          {detail?.provider_locked && selectedStatus !== 'ready' && (
            <div className="text-xs rounded-xl border px-4 py-3 leading-relaxed space-y-2">
              <p className="font-medium">{t('connect.nodeProviderLockedHow', { label: selectedEntry?.label || selected || '' })}</p>
              {detail?.check_ready?.login_command && (
                <p className="text-muted-foreground">
                  {t('connect.nodeProviderLockedLogin')}{' '}
                  <code className="font-mono bg-muted rounded px-1.5 py-0.5">{detail.check_ready.login_command}</code>
                </p>
              )}
              <p className="text-muted-foreground">
                {t('connect.nodeProviderLockedKey', { label: selectedEntry?.label || selected || '' })}
                {selectedEntry?.homepage && (
                  <>
                    {' '}
                    <a href={selectedEntry.homepage} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                      {selectedEntry.homepage.replace(/^https?:\/\//, '')}
                    </a>
                  </>
                )}
              </p>
            </div>
          )}

          {/* Smoke test — per AGENT, so it only exists once the agent does
              (probes run automatically after create/reconfigure and hourly;
              nothing is probed for a bare agent type). */}
          {isEdit && editAgent && (
            <SmokeTestPanel
              nodeId={node.nodeId}
              agentName={editAgent.name}
              probe={(node.agents || []).find((a) => a.name === editAgent.name)?.probe}
              onChanged={onChanged}
            />
          )}

          {/* Name (fixed when editing an existing agent) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('connect.nodeAgentNameLabel')}</Label>
            <Input value={name} onChange={(e) => { setName(e.target.value); nameTouched.current = true; }} placeholder={t('connect.nodeAgentNamePlaceholder')} className="h-10 text-sm" disabled={isEdit} />
          </div>

          {/* Bring-your-own-provider: saved model access → model, live-verified */}
          {byok && (
            <div className="space-y-3 rounded-xl border border-indigo-500/25 bg-gradient-to-b from-indigo-500/[0.05] to-transparent p-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                  <Key className="size-3.5 text-indigo-500" />{t('connect.byokTitle')}
                </span>
                {byokTest.state === 'ok' && (
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />{t('connect.byokVerifiedShort')}
                  </span>
                )}
              </div>

              {/* Saved model access + add-new */}
              <div className="flex gap-2">
                <select
                  value={byokAccessId}
                  onChange={(e) => pickAccess(e.target.value)}
                  className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">{t('connect.byokProviderNone')}</option>
                  {byokAccessOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.label} · {a.apiKeyMasked}</option>
                  ))}
                </select>
                <Button variant="outline" onClick={() => setShowAccessDialog(true)} className="h-10 shrink-0">
                  <Plus className="size-3.5 mr-1.5" />{t('connect.byokAddAccess')}
                </Button>
              </div>

              {/* One-click promo credits — OpenAI-protocol agents the campaign
                  gateway can back. Selects (or creates) the gateway access. */}
              {selected && byokProtocol !== 'anthropic' && CAMPAIGN_PROMO_AGENT_TYPES.has(selected) && (
                <CampaignPromoAccess
                  agentType={selected}
                  accesses={accesses}
                  selectedAccessId={byokAccessId}
                  onUse={(entry, created) => {
                    if (created) setAccesses((prev) => [entry, ...(prev || [])]);
                    pickAccess(entry.id);
                  }}
                />
              )}

              {accesses !== null && accesses.length === 0 && !byokAccessId && (
                <p className="text-[11px] text-muted-foreground">{t('connect.byokNoAccessHint')}</p>
              )}

              {byokAccessId && (
                <>
                  {byokLoading && (
                    <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />{t('connect.byokLoadingModels')}
                    </p>
                  )}
                  {byokKeyError && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">{byokKeyError}</p>
                  )}

                  {/* Model — the ones this key can actually use */}
                  {byokModels && (
                    <div className="space-y-1.5">
                      <select
                        value={byokCustomModel ? '__custom__' : model}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') { setByokCustomModel(true); setModel(''); }
                          else { setByokCustomModel(false); setModel(e.target.value); }
                          setByokTest({ state: 'idle' });
                        }}
                        className="w-full h-10 text-sm rounded-md border bg-background px-3"
                      >
                        <option value="">{t('connect.byokChooseModel')}</option>
                        {byokModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                        <option value="__custom__">{t('connect.byokCustomModel')}</option>
                      </select>
                      {byokCustomModel && (
                        <Input
                          value={model}
                          onChange={(e) => { setModel(e.target.value); setByokTest({ state: 'idle' }); }}
                          placeholder="claude-sonnet-4-6"
                          className="h-10 text-sm font-mono"
                        />
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        {byokModelsSource === 'live'
                          ? t('connect.byokModelsLive', { count: byokModels.length })
                          : t('connect.byokModelsCatalog')}
                      </p>
                    </div>
                  )}

                  {/* Live validation before adding */}
                  <div className="flex items-start gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={testByok}
                      disabled={!model.trim() || byokTest.state === 'testing'}
                      className="shrink-0"
                    >
                      {byokTest.state === 'testing'
                        ? (<><Loader2 className="size-3.5 mr-1.5 animate-spin" />{t('connect.byokTesting')}</>)
                        : (<><Zap className="size-3.5 mr-1.5" />{t('connect.byokTest')}</>)}
                    </Button>
                    {byokTest.state === 'ok' && (
                      <span className="text-[11px] leading-relaxed text-emerald-600 dark:text-emerald-400 pt-1.5">
                        {t('connect.byokTestOk', { model: model.trim(), ms: byokTest.ms ?? 0 })}
                      </span>
                    )}
                    {byokTest.state === 'fail' && (
                      <span className="text-[11px] leading-relaxed text-red-600 dark:text-red-400 pt-1.5">
                        {t('connect.byokTestFail')}{byokTest.error ? ` — ${byokTest.error}` : ''}
                      </span>
                    )}
                  </div>
                </>
              )}

              {showAccessDialog && (
                <AddModelAccessDialog
                  providers={cloudProviders}
                  onClose={() => setShowAccessDialog(false)}
                  onSaved={(entry) => {
                    setShowAccessDialog(false);
                    setAccesses((prev) => [entry, ...(prev || [])]);
                    pickAccess(entry.id);
                  }}
                />
              )}
            </div>
          )}

          {/* Model — curated dropdown; hidden while a saved model access is
              driving the list (its live models replace the curated set). */}
          {modelOptions && !(byok && byokAccessId) && !baseUrl.trim() && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('connect.nodeModel')}</Label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full h-10 text-sm rounded-md border bg-background px-3"
              >
                <option value="">{t('connect.nodeModelAuto')}</option>
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Working directory — optional, managed default, with a folder picker */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('connect.nodeWorkingDirOptional')}</Label>
            <div className="flex gap-2">
              <Input value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} placeholder={t('connect.nodeWorkingDirPlaceholder')} className="h-10 text-sm font-mono flex-1" />
              <Button variant="outline" onClick={() => setShowPicker((v) => !v)} className="h-10 shrink-0">
                <Folder className="size-4 mr-1.5" />{t('connect.nodeBrowse')}
              </Button>
            </div>
            {showPicker && (
              <FolderPicker
                node={node}
                onPick={(p) => setWorkingDir(p)}
                onClose={() => setShowPicker(false)}
              />
            )}
            <p className="text-[11px] text-muted-foreground">{t('connect.nodeWorkingDirHint')}</p>
          </div>

          {/* Credentials — optional (BYOK agents configure them above instead) */}
          {byok ? null : !showCreds ? (
            <button onClick={() => setShowCreds(true)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5">
              <Key className="size-3.5" />{t('connect.nodeCredsOptional')}
            </button>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs font-medium">{t('connect.nodeCredsOptional')}</Label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isEdit && editAgent?.apiKeyMasked ? editAgent.apiKeyMasked : t('connect.nodeAgentKeyOptional')}
                type="password"
                className="h-10 text-sm"
              />
              {isEdit && editAgent?.apiKeyMasked && (
                <p className="text-[11px] text-muted-foreground">
                  {t('connect.nodeKeyConfiguredHint', { masked: editAgent.apiKeyMasked })}
                </p>
              )}
              {/* No custom endpoint for provider-locked agents — as dead an
                  option as a relay key. */}
              {!detail?.provider_locked && (
                <>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={t('connect.nodeAgentBaseUrlOptional')}
                    className="h-10 text-sm font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">{t('connect.nodeAgentBaseUrlHint')}</p>
                </>
              )}
              {/* Custom endpoint set → the curated model ids don't apply; take
                  the endpoint's own model id as free text instead. */}
              {(!modelOptions || !!baseUrl.trim()) && (
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('connect.nodeAgentModelOptional')} className="h-10 text-sm" />
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="ghost" onClick={isEdit ? onBack : backToSelection} disabled={busy}>{t('connect.nodeCancel')}</Button>
            <Button variant="primary" onClick={create} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Plus className="size-4 mr-1.5" />}
              {isEdit ? t('connect.nodeSaveChanges') : t('connect.nodeCreateAgent')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Selection mode: the agent marketplace --------------------------------
  const statusOf = (name: string) => runtimeStatus(runtimeByType[name]);
  const checkingOf = (name: string) => detecting && !runtimeByType[name];
  const featured = catalog.filter((e) => e.featured);
  const readyCount = catalog.filter((e) => {
    const s = statusOf(e.name);
    return s === 'ready' || s === 'needs_login';
  }).length;

  const marketCats = [
    { key: 'all', label: t('connect.marketCatAll') },
    { key: 'ready', label: t('connect.marketCatReady') },
    { key: 'open-source', label: t('connect.marketCatOpenSource') },
    { key: 'cli', label: t('connect.marketCatTerminal') },
    { key: 'editor', label: t('connect.marketCatIde') },
  ];
  const q = marketQuery.trim().toLowerCase();
  const visible = catalog.filter((e) => {
    const s = statusOf(e.name);
    const tags = e.tags || [];
    if (marketCat === 'ready' && s !== 'ready' && s !== 'needs_login') return false;
    if (marketCat === 'open-source' && !tags.includes('open-source')) return false;
    if (marketCat === 'cli' && !(tags.includes('cli') || tags.includes('terminal'))) return false;
    if (marketCat === 'editor' && !(tags.includes('editor') || tags.includes('vscode') || tags.includes('ide-extension'))) return false;
    if (!q) return true;
    return [e.name, e.label, e.vendor || '', e.description, ...tags].join(' ').toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-4 max-w-4xl mx-auto w-full">
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
          <h3 className="text-base font-bold tracking-tight">{t('connect.nodeAddAgentTitle', { node: node.name })}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {detecting
              ? t('connect.nodeDetectingAgents')
              : t('connect.marketSummary', { count: catalog.length, ready: readyCount })}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={reDetect} disabled={detecting}>
          <RefreshCw className={cn('size-3.5 mr-1', detecting && 'animate-spin')} />
          {detecting ? t('connect.nodeDetecting') : t('connect.nodeReDetect')}
        </Button>
      </div>

      {/* Featured spotlight */}
      <MarketHero slides={featured} statusOf={statusOf} checkingOf={checkingOf} onPick={pick} />

      {/* Toolbar: search + category chips */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
          <input
            value={marketQuery}
            onChange={(e) => setMarketQuery(e.target.value)}
            placeholder={t('connect.marketSearch')}
            className="w-full h-9 rounded-lg border bg-background pl-9 pr-3 text-xs outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/10 transition-shadow"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {marketCats.map((c) => (
            <button
              key={c.key}
              onClick={() => setMarketCat(c.key)}
              className={cn(
                'whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors',
                marketCat === c.key
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Marketplace grid — Popular agents first, then everything else. */}
      {(() => {
        const popular = MARKET_POPULAR_AGENTS
          .map((n) => visible.find((e) => e.name === n))
          .filter((e): e is (typeof visible)[number] => !!e);
        const others = visible.filter((e) => !MARKET_POPULAR_AGENTS.includes(e.name));

        const renderCard = (entry: (typeof visible)[number]) => (
          <button
            key={entry.name}
            onClick={() => pick(entry.name)}
            className="group relative flex flex-col gap-3 rounded-2xl border bg-background p-4 text-left transition-all duration-200 hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/[0.08] hover:-translate-y-0.5"
          >
            <div className="flex items-center gap-3">
              <MarketLogo name={entry.name} size={44} />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold leading-tight truncate">{entry.label}</div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/80 truncate">{entry.vendor || entry.tags?.[0] || ''}</div>
              </div>
            </div>

            <p className="text-[11.5px] leading-relaxed text-muted-foreground line-clamp-2 min-h-[33px]">{entry.description}</p>

            {/* Footer: live device status + an always-visible Add CTA (the
                whole card is the click target; this span is its label). */}
            <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
              <MarketStatusBadge status={statusOf(entry.name)} checking={checkingOf(entry.name)} />
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-[10.5px] font-semibold text-white transition-colors group-hover:bg-indigo-500">
                {t('connect.marketAdd')} <ArrowRight className="size-3" />
              </span>
            </div>
          </button>
        );

        if (visible.length === 0) {
          return (
            <div className="rounded-2xl border border-dashed py-14 text-center text-sm text-muted-foreground">
              {t('connect.marketNoMatch', { query: marketQuery })}{' '}
              <button className="text-indigo-600 dark:text-indigo-400 font-medium" onClick={() => { setMarketQuery(''); setMarketCat('all'); }}>
                {t('connect.marketReset')}
              </button>
            </div>
          );
        }
        return (
          <div className="space-y-5">
            {popular.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('connect.marketPopular')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {popular.map(renderCard)}
                </div>
              </div>
            )}
            {others.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('connect.marketOthers')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {others.map(renderCard)}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function NodesTab({
  nodes,
  catalog,
  cloudProviders,
  autoAddAgent = false,
  onFirstAgentCreated,
  loading,
  pairing,
  pairingLoading,
  onGenerate,
  onDismissPairing,
  onRefresh,
}: {
  nodes: WorkspaceNode[];
  catalog: AgentCatalogEntry[];
  cloudProviders: CloudAgentProvider[];
  autoAddAgent?: boolean;
  onFirstAgentCreated?: (agentName: string) => void;
  loading: boolean;
  pairing: PairingCode | null;
  pairingLoading: boolean;
  onGenerate: () => void;
  onDismissPairing: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  const [addingNodeId, setAddingNodeId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ nodeId: string; agent: import('@/lib/types').NodeAgent } | null>(null);
  // Optimistic "spinning up" agents per node, until the real roster reports
  // them. `at` is the creation timestamp; `commandId` ties the placeholder to
  // the create_agent command so its display tracks the REAL install/config
  // progress (a queued openclaw install can legitimately take minutes — a
  // blind timer used to flip to "not up yet" mid-install and send the user
  // off to debug a healthy device).
  const [pending, setPending] = useState<Record<string, PendingAgent[]>>({});

  const addPending = (nodeId: string, agent: { name: string; type: string; commandId?: string }) =>
    setPending((prev) => ({ ...prev, [nodeId]: [...(prev[nodeId] || []).filter((p) => p.name !== agent.name), { ...agent, at: Date.now() }] }));

  // Drop placeholders once the node's real roster includes them.
  useEffect(() => {
    setPending((prev) => {
      let changed = false;
      const next: Record<string, PendingAgent[]> = {};
      for (const [nodeId, list] of Object.entries(prev)) {
        const node = nodes.find((n) => n.nodeId === nodeId);
        const roster = node?.agents || [];
        const kept = list.filter((p) => !roster.some((a) => a.name === p.name));
        if (kept.length !== list.length) changed = true;
        if (kept.length) next[nodeId] = kept;
      }
      return changed ? next : prev;
    });
  }, [nodes]);

  // Track each placeholder's command through the node command feed. A change
  // to `done` restarts the stall clock: install/config is over, and only from
  // that point does "the roster hasn't reported it" mean something is wrong.
  useEffect(() => {
    const nodeIds = Object.keys(pending).filter((nid) => (pending[nid] || []).some((p) => p.commandId && p.cmdStatus !== 'done' && p.cmdStatus !== 'error'));
    if (!nodeIds.length) return;
    let cancelled = false;
    const tick = async () => {
      for (const nid of nodeIds) {
        try {
          const cmds = await workspaceApi.listNodeCommands(nid);
          if (cancelled) return;
          setPending((prev) => {
            const list = prev[nid];
            if (!list?.length) return prev;
            let changed = false;
            const next = list.map((p) => {
              if (!p.commandId) return p;
              const c = cmds.find((x) => x.commandId === p.commandId);
              if (!c || c.status === p.cmdStatus) return p;
              changed = true;
              return {
                ...p,
                cmdStatus: c.status,
                cmdMessage: c.result?.message ?? null,
                at: c.status === 'done' ? Date.now() : p.at,
              };
            });
            return changed ? { ...prev, [nid]: next } : prev;
          });
        } catch { /* transient — next tick retries */ }
      }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pending]);

  // Onboarding step 3: jump straight into the agent gallery for the connected
  // node (once), so the user picks an agent immediately instead of hunting for
  // the "Add agent" button.
  const autoAddedRef = useRef(false);
  useEffect(() => {
    if (!autoAddAgent || autoAddedRef.current) return;
    const target = nodes.find((n) => (n.agents || []).length === 0) || nodes[0];
    if (target) { autoAddedRef.current = true; setAddingNodeId(target.nodeId); }
  }, [autoAddAgent, nodes]);

  // The gallery works on live node data (runtimes refresh via polling), so look
  // the node up by id each render rather than snapshotting it.
  const addingNode = addingNodeId ? nodes.find((n) => n.nodeId === addingNodeId) : null;
  if (addingNode) {
    return (
      <AddAgentGallery
        node={addingNode}
        catalog={catalog}
        cloudProviders={cloudProviders}
        onBack={() => setAddingNodeId(null)}
        onChanged={onRefresh}
        onQueued={(agent) => {
          addPending(addingNode.nodeId, agent);
          capture('agent_created', { agent_type: agent.type, source: 'workspace_ui' });
          // Onboarding first agent → open a thread with it once it joins.
          if (autoAddAgent) onFirstAgentCreated?.(agent.name);
        }}
      />
    );
  }

  const editingNode = editing ? nodes.find((n) => n.nodeId === editing.nodeId) : null;
  if (editing && editingNode) {
    return (
      <AddAgentGallery
        key={`edit-${editing.agent.name}`}
        node={editingNode}
        catalog={catalog}
        cloudProviders={cloudProviders}
        editAgent={editing.agent}
        onBack={() => setEditing(null)}
        onChanged={onRefresh}
      />
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-2xl mx-auto w-full">
      {/* Heading + refresh */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-tight">{t('connect.nodeHeading')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('connect.nodeSubtitle')}</p>
        </div>
        <button
          onClick={onRefresh}
          className="shrink-0 size-9 flex items-center justify-center rounded-lg border text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={t('connect.nodeRefresh')}
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Node list / empty state */}
      {loading && nodes.length === 0 ? (
        <div className="flex items-center justify-center py-14 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          <span className="text-sm">{t('common.loading')}</span>
        </div>
      ) : nodes.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-14 px-6 text-center">
          <div className="size-16 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md">
            <Server className="size-8 text-white" />
          </div>
          <div className="text-base font-semibold mt-5">{t('connect.nodeEmptyTitle')}</div>
          <p className="text-xs text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">{t('connect.nodeEmptyBody')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {nodes.map((node) => (
            <NodeCard
              key={node.nodeId}
              node={node}
              pending={pending[node.nodeId] || []}
              onAddAgent={() => setAddingNodeId(node.nodeId)}
              onEditAgent={(agent) => setEditing({ nodeId: node.nodeId, agent })}
              onChanged={onRefresh}
            />
          ))}
        </div>
      )}

      {/* Pairing code panel, or the connect button */}
      {pairing ? (
        <PairingPanel pairing={pairing} onDismiss={onDismissPairing} />
      ) : nodes.length === 0 ? (
        <Button onClick={onGenerate} disabled={pairingLoading} className="w-full h-12 text-sm" variant="primary" size="lg">
          {pairingLoading ? (
            <><Loader2 className="size-4 animate-spin mr-2" />{t('connect.nodeGenerating')}</>
          ) : (
            <><Plus className="size-4 mr-2" />{t('connect.nodeConnect')}</>
          )}
        </Button>
      ) : (
        <button
          onClick={onGenerate}
          disabled={pairingLoading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed py-3.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/[0.03] transition-colors disabled:opacity-50"
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
                  {t('connect.nodeMacSilicon')}
                </a>
                <a
                  href="https://openagents.org/api/download/launcher/mac-intel"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center px-3 py-2 text-[11px] font-medium rounded-md border hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  {t('connect.nodeMacIntel')}
                </a>
                <a
                  href="https://openagents.org/api/download/launcher/windows"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center px-3 py-2 text-[11px] font-medium rounded-md border hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Windows
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
                      onClick={() => { capture('cli_install_copied', { step: 'install_cli', source: 'connect_agent_view' }); copyToClipboard('curl -fsSL https://openagents.org/install.sh | bash'); }}
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
                      onClick={() => { capture('cli_install_copied', { step: 'install_agent', agent_type: selectedEntry.name, source: 'connect_agent_view' }); copyToClipboard(`agn install ${selectedEntry.name}`); }}
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
                      onClick={() => { capture('cli_install_copied', { step: 'create_agent', agent_type: selectedEntry.name, source: 'connect_agent_view' }); copyToClipboard(`agn create my-${selectedEntry.name} --type ${selectedEntry.name}`); }}
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
                      onClick={() => { capture('cli_install_copied', { step: 'connect_agent', agent_type: selectedEntry.name, source: 'connect_agent_view' }); copyToClipboard(`agn connect my-${selectedEntry.name} ${token}`); }}
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
                      onClick={() => { capture('cli_install_copied', { step: 'daemon_up', source: 'connect_agent_view' }); copyToClipboard('agn up'); }}
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
                      onClick={() => { capture('cli_install_copied', { step: 'status', source: 'connect_agent_view' }); copyToClipboard('agn status'); }}
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
                <button
                  type="button"
                  onClick={async () => {
                    // Fetch with auth headers, then navigate — the workspace
                    // token must never ride in a URL (server logs, history).
                    try {
                      const { url } = await workspaceApi.getGoogleOAuthUrl(
                        cfgName || 'gemini',
                        cfgModel || 'gemini-3.5-flash',
                      );
                      window.location.assign(url);
                    } catch {
                      toast.error(t('connect.googleAuthFailed'));
                    }
                  }}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-lg border-2 border-input bg-background hover:bg-accent transition-colors text-sm font-medium"
                >
                  <svg viewBox="0 0 24 24" className="size-4" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {t('connect.signInWithGoogle')}
                </button>
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

// ---------------------------------------------------------------------------
// First-run onboarding — a brand-new workspace (no agents, no nodes) goes
// straight to connecting a device: the pairing code is minted and shown
// immediately (manual connection is being retired, so there is no "choose your
// path" step anymore). Cloud agents — and, for now, the manual flow — remain
// reachable via a small note under the pairing panel.
// ---------------------------------------------------------------------------

// Once per browser, not per workspace: a returning user creating their
// second workspace already knows what the product does.
const WELCOME_FILM_SEEN_KEY = 'oa:welcomeFilmSeen';

export function FirstRunOnboarding() {
  const t = useT();
  const [alt, setAlt] = useState<'local' | 'cloud' | null>(null);
  const [welcomeDone, setWelcomeDone] = useState(
    () => typeof window === 'undefined' || localStorage.getItem(WELCOME_FILM_SEEN_KEY) === '1',
  );

  useEffect(() => {
    if (!welcomeDone) capture('welcome_film_started', { source: 'guided_wizard' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishWelcome = useCallback((skipped: boolean) => {
    try { localStorage.setItem(WELCOME_FILM_SEEN_KEY, '1'); } catch { /* private mode */ }
    capture(skipped ? 'welcome_film_skipped' : 'welcome_film_completed', { source: 'guided_wizard' });
    setWelcomeDone(true);
  }, []);

  // Escape hatches reuse the full connect view on the right tab.
  if (alt) return <ConnectAgentView initialTab={alt} />;

  // Value first: three pillar slides (hub → collaboration → humans+agents)
  // play full screen before any ask (download, pairing). Each slide animates
  // once and holds its closing frame; the user pages with prev/next, the last
  // slide's CTA — or skipping at any point — drops into the pairing step.
  // On phones the slides letterbox like any landscape video and the controls
  // keep full-size touch targets.
  if (!welcomeDone) {
    return (
      // fixed, not h-full: the intro owns the entire viewport, covering the
      // nav rail / header (desktop) and header / tab bar (mobile) alike.
      <div className="fixed inset-0 z-[100] overflow-hidden bg-white">
        <WelcomeFilm
          embedded
          onEnded={() => finishWelcome(false)}
          onSkip={() => finishWelcome(true)}
          skipLabel={t('onboarding.skipIntro')}
          ctaLabel={t('onboarding.getStarted')}
        />
      </div>
    );
  }

  return (
    <NodeOnboardingStep
      footer={
        <div className="pt-4 text-center space-y-2">
          {/* Onboarding-only: replay the welcome slides (gone once agents exist,
              since FirstRunOnboarding itself no longer renders then) */}
          <div>
            <button
              onClick={() => {
                capture('welcome_film_replayed', { source: 'guided_wizard' });
                setWelcomeDone(false);
              }}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="size-3.5" />{t('onboarding.replayIntro')}
            </button>
          </div>
          <div>
            <button
              onClick={() => setAlt('cloud')}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Cloud className="size-3.5" />{t('onboarding.chooseCloud')}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground/60">
            {t('onboarding.manualRetiringNote')}{' '}
            <button onClick={() => setAlt('local')} className="underline underline-offset-2 hover:text-foreground transition-colors">
              {t('onboarding.manualRetiringLink')}
            </button>
          </p>
        </div>
      }
    />
  );
}

/** Bottom progress indicator for the onboarding flow. */
function OnboardingSteps({ current }: { current: number }) {
  const t = useT();
  // Two steps since the "choose your path" screen was retired: the flow goes
  // straight to the pairing code.
  const steps = [
    t('onboarding.stepperConnect'),
    t('onboarding.stepperStart'),
  ];
  return (
    <div className="shrink-0 border-t py-4 px-6">
      <div className="flex items-center justify-center gap-2 max-w-md mx-auto">
        {steps.map((label, i) => {
          const n = i + 1;
          const active = n === current;
          const done = n < current;
          return (
            <div key={label} className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'size-6 rounded-full flex items-center justify-center text-[11px] font-semibold',
                  active ? 'bg-primary text-primary-foreground'
                    : done ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}>
                  {done ? <Check className="size-3.5" /> : n}
                </span>
                <span className={cn('text-xs font-medium hidden sm:inline', active ? 'text-foreground' : 'text-muted-foreground')}>
                  {label}
                </span>
              </div>
              {n < steps.length && <span className="w-6 h-px bg-border" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Onboarding step 2 — connect a node. A focused view: just the pairing code,
 * install options, and the live "waiting" indicator (no tabs, no empty state).
 * Once a device connects it advances to step 3 (add an agent).
 */
function NodeOnboardingStep({ onBack, footer }: { onBack?: () => void; footer?: React.ReactNode }) {
  const t = useT();
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [connected, setConnected] = useState(false);
  const [errored, setErrored] = useState(false);
  const baselineRef = useRef<Set<string>>(new Set());

  // On mount: snapshot existing nodes, then either jump to step 3 (a node is
  // already here) or mint a pairing code.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ns = await workspaceApi.listNodes();
        if (cancelled) return;
        baselineRef.current = new Set(ns.map((n) => n.nodeId));
        if (ns.length > 0) { setConnected(true); return; }
        const code = await workspaceApi.createPairingCode();
        if (!cancelled) {
          setPairing(code);
          capture('pairing_code_generated', { source: 'guided_wizard' });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '';
        toast.error(/40[13]/.test(msg) ? t('connect.nodePairingForbidden') : t('connect.nodePairingFailed'));
        setErrored(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for a newly connected device while waiting.
  useEffect(() => {
    if (connected) return;
    const id = setInterval(async () => {
      try {
        const ns = await workspaceApi.listNodes();
        if (ns.some((n) => !baselineRef.current.has(n.nodeId))) {
          setConnected(true);
          toast.success(t('connect.nodeConnectedToast'));
          capture('node_connected', { source: 'guided_wizard' });
        }
      } catch { /* transient */ }
    }, 3000);
    return () => clearInterval(id);
  }, [connected, t]);

  // Step 3 — the device is connected; hand off to the connect view to add an
  // agent, keeping the step indicator pinned below.
  if (connected) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden">
          <ConnectAgentView initialTab="node" autoAddAgent />
        </div>
        <OnboardingSteps current={2} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto w-full px-6 py-10 space-y-6">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="size-3.5 rotate-180" />{t('connect.nodeBack')}
            </button>
          )}

          <div className="text-center">
            <div className="size-14 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md">
              <Server className="size-7 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight mt-4">{t('onboarding.nodeStepTitle')}</h1>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">{t('onboarding.nodeStepBody')}</p>
          </div>

          {pairing ? (
            <PairingPanel pairing={pairing} onDismiss={onBack ?? (() => {})} />
          ) : errored ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
              {t('connect.nodePairingFailed')}
            </div>
          ) : (
            <div className="flex items-center justify-center py-14 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}

          {footer}
        </div>
      </div>
      <OnboardingSteps current={1} />
    </div>
  );
}
