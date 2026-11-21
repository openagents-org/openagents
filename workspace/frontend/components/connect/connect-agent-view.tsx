'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useLayout, type DeviceSetupMethod } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useRetryingLoad } from '@/hooks/use-retrying-load';
import { useT } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import { desktopHost } from '@/lib/desktop-host';
import { OnboardingPairingPanel } from './onboarding-pairing-panel';
import { SetupEmailButton } from './setup-email-button';
import { ConnectionTabs } from './connection-tabs';
import { OnboardingConnectionHero } from './onboarding-connection-hero';
import { withWorkspaceAgentInfo } from '@/lib/node-agent-labels';
import { capture } from '@/lib/analytics';
import { toast } from 'sonner';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { CampaignConnectHint } from '@/components/campaign/campaign-feedback';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import type { AgentCatalogEntry, CloudAgentConfig, CloudAgentProvider, WorkspaceNode, PairingCode } from '@/lib/types';
import { NodesTab } from './nodes-tab';
import { CloudAgentsTab } from './cloud-agents-tab';

// The welcome film is ~2k lines of scene choreography only first-run users
// ever see — load it on demand so the connect view's bundle stays lean.
const EMPTY_CATALOG: AgentCatalogEntry[] = [];
const EMPTY_PROVIDERS: CloudAgentProvider[] = [];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectAgentView({
  initialTab = 'node',
  autoPair = false,
  autoAddAgent = false,
  preferredNodeId,
  footer,
  onDismiss,
}: {
  initialTab?: 'local' | 'cloud' | 'node';
  autoPair?: boolean;
  autoAddAgent?: boolean;
  preferredNodeId?: string;
  footer?: React.ReactNode;
  onDismiss?: () => void;
} = {}) {
  const t = useT();
  const { openView, openMobileDetail, connectSetupRequest, cloudAgentsPending, consumeCloudAgents, addAgentPending, editAgentPending } = useLayout();
  const { workspace, token, refreshWorkspace, agents, requestFirstThread } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const { idToken: oaIdToken } = useOpenAgentsAuth();
  const isDesktop = desktopHost() !== null;

  const deviceRequest = useMemo(() => connectSetupRequest && connectSetupRequest.method !== 'cloud'
    ? { method: connectSetupRequest.method }
    : null, [connectSetupRequest]);
  const [selectedTab, setSelectedTab] = useState<'local' | 'cloud' | 'node'>(
    connectSetupRequest ? (connectSetupRequest.method === 'cloud' ? 'cloud' : 'node') : initialTab,
  );
  const [pairingMethod, setPairingMethod] = useState<DeviceSetupMethod>(deviceRequest?.method ?? 'terminal');
  const pairingMethodRequest = useMemo(() => ({ method: pairingMethod }), [pairingMethod]);
  const activeTab = selectedTab === 'local' ? 'node' : selectedTab;
  const appliedSetupRequest = useRef(connectSetupRequest);
  useEffect(() => {
    if (connectSetupRequest && connectSetupRequest !== appliedSetupRequest.current) {
      appliedSetupRequest.current = connectSetupRequest;
      const { method } = connectSetupRequest;
      setSelectedTab(method === 'cloud' ? 'cloud' : 'node');
      if (method !== 'cloud') setPairingMethod(method);
    }
  }, [connectSetupRequest]);
  useEffect(() => {
    if (!cloudAgentsPending) return;
    setSelectedTab('cloud');
    consumeCloudAgents?.();
  }, [cloudAgentsPending, consumeCloudAgents]);
  // Adding or editing a device agent happens on the devices tab, whichever
  // tab the view was last left on.
  useEffect(() => {
    if (addAgentPending || editAgentPending) setSelectedTab('node');
  }, [addAgentPending, editAgentPending]);

  // Onboarding checkpoint: the user reached the agent-setup surface. One event
  // per tab so the funnel can split node vs cloud vs local paths.
  useEffect(() => {
    capture('connect_agent_viewed', { tab: activeTab });
  }, [activeTab]);

  // Nodes (connect-a-node)
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  // A list that could not load is not an empty one: say so, and offer a retry.
  const [nodesError, setNodesError] = useState(false);
  // True once a node load has finished (either way), so a request waiting on
  // the list can tell "no devices" from "not fetched yet".
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState(false);

  // Local agents
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Cloud agents
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

  // Loaded separately: the catalog needs no database, the other two do, and
  // one of them failing must not leave the add-agent gallery empty.
  const catalogLoad = useRetryingLoad(() => workspaceApi.getAgentCatalog(), EMPTY_CATALOG);
  const { data: catalog } = catalogLoad;
  const { data: cloudProviders } = useRetryingLoad(() => workspaceApi.getCloudProviders(), EMPTY_PROVIDERS);
  // The view waits for the catalog's first attempt only. Retries and a final
  // failure show in the gallery itself, with a retry button.
  const [catalogSettled, setCatalogSettled] = useState(false);
  useEffect(() => {
    if (catalogLoad.status !== 'loading' || catalogLoad.failures > 0) setCatalogSettled(true);
  }, [catalogLoad.status, catalogLoad.failures]);
  const loading = !catalogSettled;
  const catalogState = { status: catalogLoad.status, retry: catalogLoad.retry };
  useEffect(() => { loadCloudAgents(); }, []);

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
    if (isCustomProvider || selectedProviderInfo?.name === 'tokenpay') {
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
      if (connectSetupRequest?.method === 'cloud' && !agents.some((agent) => !agent.builtin)) openFirstThread(cfgName);
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

  // The daemon's roster names agents by handle and reports the device's own
  // model; the workspace's display name and model pick win, so merge them in.
  const labeledNodes = useMemo(() => withWorkspaceAgentInfo(nodes, agents), [nodes, agents]);

  const loadNodes = useCallback(async (showSpinner = false) => {
    if (showSpinner) setNodesLoading(true);
    try {
      const list = await workspaceApi.listNodes();
      setNodes(list);
      setNodesError(false);
    } catch {
      // A background poll keeps the last known list; a requested load reports.
      if (showSpinner) setNodesError(true);
    } finally {
      if (showSpinner) setNodesLoading(false);
      setNodesLoaded(true);
    }
  }, []);

  // Snapshot of node ids taken when a pairing code is generated, so we can tell
  // when a *new* node connects and auto-dismiss the pairing panel.
  const pairingBaselineRef = useRef<Set<string>>(new Set());
  const pairingAgentBaseline = useRef<Set<string>>(new Set());
  const [agentJoinNodeId, setAgentJoinNodeId] = useState<string | null>(null);
  const openFirstThread = useCallback((name: string) => {
    requestFirstThread(name, () => {
      openView('threads');
      openMobileDetail();
    });
  }, [requestFirstThread, openView, openMobileDetail]);

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
  const [pairedNodeId, setPairedNodeId] = useState<string | null>(null);
  const finishPairing = useCallback((nodeId: string | null) => {
    setPairing(null);
    setPairedNodeId(nodeId);
    toast.success(t('connect.nodeConnectedToast'));
    capture('node_connected', { source: 'workspace_ui' });
  }, [t]);
  useEffect(() => {
    if (!pairing || pairingMethod === 'agent') return;
    const fresh = nodes.find((n) => !pairingBaselineRef.current.has(n.nodeId));
    if (fresh) finishPairing(fresh.nodeId);
  }, [nodes, pairing, pairingMethod, finishPairing]);
  // A device that was already paired keeps its node id, so also ask whether
  // the code itself was used (an agent joining from a machine already
  // connected here, the common case for `agn join`).
  useEffect(() => {
    if (!pairing || agentJoinNodeId || activeTab !== 'node') return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const status = await workspaceApi.getPairingCodeStatus(pairing.code);
        if (cancelled || !status.redeemed) return;
        if (pairingMethod === 'agent' && status.nodeId) setAgentJoinNodeId(status.nodeId);
        else finishPairing(status.nodeId);
        loadNodes(false);
      } catch { /* the node list keeps watching */ }
    }, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pairing, agentJoinNodeId, activeTab, pairingMethod, finishPairing, loadNodes]);

  useEffect(() => {
    if (!agentJoinNodeId || activeTab !== 'node') return;
    const node = nodes.find((entry) => entry.nodeId === agentJoinNodeId && entry.status === 'online');
    const joined = node?.agents?.find((entry) =>
      !pairingAgentBaseline.current.has(entry.name) &&
      agents.some((agent) => agent.agentName === entry.name && agent.status === 'online'),
    );
    if (!joined) return;
    setAgentJoinNodeId(null);
    setPairing(null);
    openFirstThread(joined.name);
  }, [agentJoinNodeId, agents, nodes, activeTab, openFirstThread]);

  const handleGeneratePairingCode = async () => {
    setPairingLoading(true);
    setPairingError(false);
    setAgentJoinNodeId(null);
    setPairedNodeId(null);
    try {
      pairingBaselineRef.current = new Set(nodes.map((n) => n.nodeId));
      pairingAgentBaseline.current = new Set([
        ...agents.map((agent) => agent.agentName),
        ...nodes.flatMap((node) => (node.agents ?? []).map((agent) => agent.name)),
      ]);
      const code = await workspaceApi.createPairingCode();
      setPairing(code);
      capture('pairing_code_generated', { source: 'node_tab' });
    } catch (err: unknown) {
      setPairingError(true);
      const msg = err instanceof Error ? err.message : '';
      toast.error(/40[13]/.test(msg) ? t('connect.nodePairingForbidden') : t('connect.nodePairingFailed'));
    } finally {
      setPairingLoading(false);
    }
  };

  // First run starts on an empty device list. A user who chooses a specific
  // method can also request a code for an additional device or an agent on
  // a device that's already paired.
  const autoPairedRef = useRef(false);
  const attemptedDeviceRequest = useRef(deviceRequest && autoAddAgent ? deviceRequest : null);
  useEffect(() => {
    if (activeTab !== 'node' || loading || nodesLoading || !nodesLoaded || nodesError || pairingLoading) return;
    if (deviceRequest && attemptedDeviceRequest.current !== deviceRequest) {
      attemptedDeviceRequest.current = deviceRequest;
      autoPairedRef.current = !agents.some((agent) => !agent.builtin);
      if (!pairing || agentJoinNodeId) void handleGeneratePairingCode();
      return;
    }
    if (!(autoPair || workspace?.needsFirstDevice === true) || autoPairedRef.current || deviceRequest) return;
    if (nodes.length > 0 || pairing) return;
    autoPairedRef.current = true;
    void handleGeneratePairingCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPair, workspace?.needsFirstDevice, activeTab, loading, nodesLoading, nodesLoaded, nodesError, nodes.length, pairing, pairingLoading, deviceRequest, agentJoinNodeId, agents]);

  const handleDismissPairing = () => {
    setAgentJoinNodeId(null);
    setPairingError(false);
    setPairing(null);
    loadNodes(true);
  };

  // An edit request still goes to the devices tab, which reports why it cannot
  // open the agent there; otherwise it would wait unseen until a later visit.
  const showFirstDeviceSetup = nodesLoaded && !nodesError && nodes.length === 0 &&
    (deviceRequest || (!isDesktop && (autoPair || workspace?.needsFirstDevice === true))) && !editAgentPending;
  const close = onDismiss ?? (() => openView('threads'));

  return (
    <div className="flex flex-col h-full">
      {showFirstDeviceSetup && (
        <div className="shrink-0">
          <OnboardingConnectionHero
            workspaceName={workspace?.name || t('nav.workspaceFallback')}
            onSetup={() => setSelectedTab('node')}
          />
        </div>
      )}

      {/* The desktop app shows both tabs too: most people arrive through it, and
          Cloud Agents is the only place they can find hosted agents. */}
      <ConnectionTabs activeTab={activeTab} onSelect={setSelectedTab} />

      {/* Credits-campaign incentive — Local Agents tab only: the milestone is
          about launcher/CLI agents, so it would only confuse on the Cloud
          Agents and Manual Connection tabs. */}
      {activeTab === 'node' && (
        <div className="px-6 shrink-0">
          <div className="mx-auto w-full max-w-2xl">
            <CampaignConnectHint idToken={oaIdToken} />
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Spinner data-icon="inline-start" />
            <span className="text-xs">{t('common.loading')}</span>
          </div>
        ) : activeTab === 'node' && agentJoinNodeId ? (
          <div className="mx-auto max-w-lg space-y-4 px-5 py-12">
            <div role="status" className="space-y-2">
              <p className="font-medium">{t('connect.agentJoinWaiting')}</p>
              <p className="text-sm text-muted-foreground">{t('connect.agentJoinPairedHint')}</p>
            </div>
            <Button variant="outline" onClick={() => { handleDismissPairing(); close(); }}>{t('connect.nodeCancel')}</Button>
          </div>
        ) : activeTab === 'node' && showFirstDeviceSetup ? (
          <>
            <div id="onboarding-device-setup" className="mx-auto w-full max-w-3xl scroll-mt-8 flex flex-col gap-6 px-4 py-6 sm:px-6 sm:py-7">
              {pairing ? (
                <OnboardingPairingPanel pairing={pairing} onDismiss={() => { handleDismissPairing(); close(); }} onRegenerate={handleGeneratePairingCode} regenerating={pairingLoading} methodRequest={pairingMethodRequest} onMethodChange={setPairingMethod} />
              ) : pairingError ? (
                <Empty role="alert" className="border">
                  <EmptyHeader>
                    <EmptyDescription>{t('connect.nodePairingFailed')}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" onClick={handleGeneratePairingCode} disabled={pairingLoading}>
                      {t('common.retry')}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : pairingLoading || attemptedDeviceRequest.current !== deviceRequest ? (
                <div role="status" className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
                  <Spinner />{t('connect.nodeGenerating')}
                </div>
              ) : (
                <Button className="self-start" onClick={handleGeneratePairingCode}>{t('onboarding.newPairingCode')}</Button>
              )}
              <SetupEmailButton />
              {footer}
            </div>
          </>
        ) : activeTab === 'node' ? (
          <NodesTab
            nodes={labeledNodes}
            catalog={catalog}
            catalogState={catalogState}
            cloudProviders={cloudProviders}
            autoAddAgent={autoAddAgent || autoPairedRef.current}
            preferredNodeId={preferredNodeId}
            onFirstAgentCreated={openFirstThread}
            pairedNodeId={pairedNodeId}
            onAgentJoined={openFirstThread}
            loading={nodesLoading}
            loaded={nodesLoaded}
            loadFailed={nodesError}
            pairing={pairing}
            pairingMethodRequest={pairingMethodRequest}
            onPairingMethodChange={setPairingMethod}
            showPairingError={!!deviceRequest && pairingError}
            pairingLoading={pairingLoading}
            pairingError={pairingError}
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
            onHostedChanged={refreshWorkspace}
          />
        )}
      </div>
    </div>
  );
}
