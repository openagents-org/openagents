'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useLayout } from '@/components/layout/layout-context';
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
import { withAgentDisplayNames } from '@/lib/node-agent-labels';
import { toast } from 'sonner';
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
  const { openView, connectSetupRequest, cloudAgentsPending, consumeCloudAgents } = useLayout();
  const { workspace, token, refreshWorkspace, agents, requestFirstThread } = useWorkspace();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const isDesktop = desktopHost() !== null;

  const [selectedTab, setSelectedTab] = useState<'local' | 'cloud' | 'node'>(initialTab);
  const activeTab = selectedTab === 'local' ? 'node' : selectedTab;
  const appliedSetupRequest = useRef(connectSetupRequest);
  useEffect(() => {
    if (connectSetupRequest && connectSetupRequest !== appliedSetupRequest.current) {
      appliedSetupRequest.current = connectSetupRequest;
      setSelectedTab('node');
    }
  }, [connectSetupRequest]);
  useEffect(() => {
    if (!cloudAgentsPending) return;
    setSelectedTab('cloud');
    consumeCloudAgents?.();
  }, [cloudAgentsPending, consumeCloudAgents]);

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

  // The daemon's roster names agents by handle; a workspace rename only
  // changes the display name, so merge it in for the device view.
  const labeledNodes = useMemo(() => withAgentDisplayNames(nodes, agents), [nodes, agents]);

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
  }, [t]);
  useEffect(() => {
    if (!pairing) return;
    const fresh = nodes.find((n) => !pairingBaselineRef.current.has(n.nodeId));
    if (fresh) finishPairing(fresh.nodeId);
  }, [nodes, pairing, finishPairing]);
  // A device that was already paired keeps its node id, so also ask whether
  // the code itself was used (an agent joining from a machine already
  // connected here, the common case for `agn join`).
  useEffect(() => {
    if (!pairing || activeTab !== 'node') return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const status = await workspaceApi.getPairingCodeStatus(pairing.code);
        if (!cancelled && status.redeemed) { finishPairing(status.nodeId); loadNodes(false); }
      } catch { /* the node list keeps watching */ }
    }, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pairing, activeTab, finishPairing, loadNodes]);

  const handleGeneratePairingCode = async () => {
    setPairingLoading(true);
    setPairingError(false);
    try {
      const code = await workspaceApi.createPairingCode();
      pairingBaselineRef.current = new Set(nodes.map((n) => n.nodeId));
      setPairing(code);
    } catch (err: unknown) {
      setPairingError(true);
      const msg = err instanceof Error ? err.message : '';
      toast.error(/40[13]/.test(msg) ? t('connect.nodePairingForbidden') : t('connect.nodePairingFailed'));
    } finally {
      setPairingLoading(false);
    }
  };

  // First run and explicit reentry share the guided pairing surface. Generate
  // a code only after a successful device read confirms an empty list. The
  // pairing form replaces the empty-state detour on both entry points.
  const autoPairedRef = useRef(false);
  useEffect(() => {
    if (!(autoPair || workspace?.needsFirstDevice === true) || autoPairedRef.current) return;
    if (activeTab !== 'node' || loading || nodesLoading || !nodesLoaded || nodesError) return;
    if (nodes.length > 0 || pairing || pairingLoading) return;
    autoPairedRef.current = true;
    handleGeneratePairingCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPair, workspace?.needsFirstDevice, activeTab, loading, nodesLoading, nodesLoaded, nodesError, nodes.length, pairing, pairingLoading]);

  const handleDismissPairing = () => {
    setPairing(null);
    loadNodes(true);
  };

  const showFirstDeviceSetup = !isDesktop && nodesLoaded && !nodesError && nodes.length === 0 &&
    (autoPair || workspace?.needsFirstDevice === true);
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

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Spinner data-icon="inline-start" />
            <span className="text-xs">{t('common.loading')}</span>
          </div>
        ) : activeTab === 'node' && showFirstDeviceSetup ? (
          <>
            <div id="onboarding-device-setup" className="mx-auto w-full max-w-3xl scroll-mt-8 flex flex-col gap-6 px-4 py-6 sm:px-6 sm:py-7">
              {pairing ? (
                <OnboardingPairingPanel pairing={pairing} onDismiss={close} onRegenerate={handleGeneratePairingCode} regenerating={pairingLoading} methodRequest={connectSetupRequest} />
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
              ) : (
                <div role="status" className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
                  <Spinner />{t('connect.nodeGenerating')}
                </div>
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
            onFirstAgentCreated={requestFirstThread}
            pairedNodeId={pairedNodeId}
            onAgentJoined={(name) => { requestFirstThread(name); openView('threads'); }}
            loading={nodesLoading}
            loaded={nodesLoaded}
            loadFailed={nodesError}
            pairing={pairing}
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
