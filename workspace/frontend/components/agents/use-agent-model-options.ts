'use client';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { curatedModelsFitEndpoint } from '@/lib/model-picker';
import type { CloudAgentConfig, AgentCatalogModel, NodeCommand, WorkspaceAgent, WorkspaceNode } from '@/lib/types';

/**
 * Ask the agent's node which models its endpoint serves. The node holds the
 * key, so this is a node command, answered on the node's next heartbeat.
 */
async function listNodeAgentModels(
  nodeId: string,
  agentName: string,
  isCancelled: () => boolean,
): Promise<{ models: AgentCatalogModel[] | null; error: string | null }> {
  let commandId: string;
  try {
    commandId = (await workspaceApi.enqueueNodeCommand(nodeId, 'list_models', { name: agentName })).commandId;
  } catch (e) {
    return { models: null, error: e instanceof Error ? e.message : null };
  }
  for (let i = 0; i < 20 && !isCancelled(); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const cmds = await workspaceApi.listNodeCommands(nodeId).catch((): NodeCommand[] => []);
    const c = cmds.find((x) => x.commandId === commandId);
    if (!c || (c.status !== 'done' && c.status !== 'error')) continue;
    const models = (c.result?.data as { models?: AgentCatalogModel[] } | undefined)?.models || [];
    return c.result?.ok && models.length
      ? { models, error: null }
      : { models: null, error: c.result?.message || null };
  }
  return { models: null, error: null };
}

const chatOnly = (models: AgentCatalogModel[]) => models.filter((m) => (m.category ?? 'chat') === 'chat');

/**
 * Model picker — options come from the agent catalog (node agents) or the
 * cloud provider catalog (cloud agents). Saving PATCHes the member for node
 * agents (the launcher applies it on the next reply) or the cloud config.
 */
export function useAgentModelOptions({ agent, isCloud, cloudConfig, setCloudConfig, refreshWorkspace }: {
  agent: WorkspaceAgent | undefined;
  isCloud: boolean;
  cloudConfig: CloudAgentConfig | null;
  setCloudConfig: (config: CloudAgentConfig | null) => void;
  refreshWorkspace: () => Promise<unknown> | void;
}) {
  const t = useT();
  const [modelOptions, setModelOptions] = useState<AgentCatalogModel[] | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const agentType = agent?.agentType || null;
  const agentName = agent?.agentName || null;
  // Some node agents never read the model picked here (for example Gemini): their
  // CLI takes the model from the agent's own configuration. Saying "switches
  // on the next reply" for those was untrue, so the picker is only offered
  // where the registry says the adapter applies it.
  const [modelApplies, setModelApplies] = useState(true);
  // A node agent pointed at a relay or another vendor's endpoint can't use the
  // catalog's ids: picking one failed its next task. Its node reports the
  // endpoint host; when the catalog isn't that endpoint's, the node is asked
  // which models the endpoint serves, and failing that the model is typed.
  // A launcher too old to report a host keeps the catalog list.
  const [endpointHost, setEndpointHost] = useState<string | null>(null);
  const [catalogFits, setCatalogFits] = useState(true);
  const [liveModels, setLiveModels] = useState<AgentCatalogModel[] | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  // A node agent on its CLI's own sign-in (a ChatGPT or Claude subscription)
  // has no endpoint to list. Its node asks the CLI what that account is
  // offered and reports it on the roster; the catalog's list, kept by hand,
  // stays the fallback for a launcher that does not report one.
  const [accountModels, setAccountModels] = useState<AgentCatalogModel[] | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [modelReload, setModelReload] = useState(0);
  useEffect(() => {
    setModelOptions(null);
    setModelApplies(true);
    setEndpointHost(null);
    setCatalogFits(true);
    setLiveModels(null);
    setLiveLoading(false);
    setLiveError(null);
    setAccountModels(null);
    setManualEntry(false);
    setModelLoadError(null);
    if (!agentType || !agentName) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    const failed = (e: unknown) => {
      if (cancelled) return;
      setLiveLoading(false);
      setModelOptions([]);
      setModelLoadError(e instanceof Error ? e.message : String(e));
    };
    if (agentType.startsWith('cloud:')) {
      const provider = agentType.replace('cloud:', '');
      workspaceApi.getCloudProviders().then((provs) => {
        if (cancelled) return;
        const p = provs.find((x) => x.name === provider);
        setModelOptions(chatOnly(p?.models || []));
      }).catch(failed);
    } else {
      Promise.all([
        workspaceApi.getAgentCatalogDetail(agentType),
        workspaceApi.listNodes().catch((): WorkspaceNode[] => []),
      ]).then(async ([detail, nodes]) => {
        if (cancelled) return;
        setModelOptions(chatOnly(detail?.models || []));
        setModelApplies(detail?.workspace_model === true);
        if (detail?.workspace_model !== true) return;
        const node = nodes.find((n) => (n.agents || []).some((a) => a.name === agentName));
        const hosted = node?.agents.find((a) => a.name === agentName);
        const host = hosted?.baseUrlHost || null;
        if (!node || !host) {
          setAccountModels(hosted?.cliModels?.length ? hosted.cliModels : null);
          return;
        }
        const providers = detail?.models_provider
          ? await workspaceApi.getCloudProviders().catch(() => [])
          : [];
        if (cancelled) return;
        setEndpointHost(host);
        const fits = curatedModelsFitEndpoint({
          baseUrlHost: host,
          modelsProvider: detail?.models_provider,
          providers,
        });
        setCatalogFits(fits);
        if (fits) return;
        setLiveLoading(true);
        const live = await listNodeAgentModels(node.nodeId, agentName, isCancelled);
        if (cancelled) return;
        setLiveLoading(false);
        setLiveModels(live.models);
        setLiveError(live.error);
      }).catch(failed);
    }
    return () => { cancelled = true; };
  }, [agentType, agentName, modelReload]);

  // A cloud agent on a custom endpoint gets that endpoint's own list; the
  // provider catalog is the vendor's line-up, which a relay may not serve.
  const cloudBaseUrl = cloudConfig?.baseUrl || null;
  const cloudProvider = cloudConfig?.provider || null;
  const [cloudLiveModels, setCloudLiveModels] = useState<AgentCatalogModel[] | null>(null);
  useEffect(() => {
    setCloudLiveModels(null);
    if (!isCloud || !agentName) return;
    if (!cloudBaseUrl && cloudProvider !== 'custom' && cloudProvider !== 'custom-anthropic') return;
    let cancelled = false;
    workspaceApi.listCloudAgentModels(agentName).then((r) => {
      if (cancelled || r.source !== 'live') return;
      setCloudLiveModels(chatOnly(r.models || []));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isCloud, agentName, cloudBaseUrl, cloudProvider]);

  const currentModel = isCloud ? (cloudConfig?.model || '') : (agent?.model || '');
  const [modelDraft, setModelDraft] = useState(currentModel);
  useEffect(() => { setModelDraft(currentModel); }, [currentModel]);
  const pickerOptions = isCloud
    ? (cloudLiveModels?.length ? cloudLiveModels : modelOptions)
    : catalogFits
      ? (accountModels?.length ? accountModels : modelOptions)
      : liveModels;
  const modelLoading = modelOptions === null || liveLoading;
  const typeModel = modelApplies && !modelLoading && (
    manualEntry
    || Boolean(modelLoadError)
    || (pickerOptions?.length ?? 0) === 0
    || (!catalogFits && !liveModels?.length)
  );

  const handleModelChange = useCallback(async (value: string) => {
    if (!agent) return;
    setSavingModel(true);
    try {
      if (isCloud) {
        await workspaceApi.updateCloudAgent(agent.agentName, { model: value });
        const configs = await workspaceApi.listCloudAgents();
        setCloudConfig(configs.find((c) => c.agentName === agent.agentName) || null);
      } else {
        await workspaceApi.updateMember(agent.agentName, { model: value });
        await refreshWorkspace();
      }
      toast.success(t('agents.modelSaved'));
    } catch {
      toast.error(t('agents.modelSaveFailed'));
    } finally {
      setSavingModel(false);
    }
  }, [agent, isCloud, refreshWorkspace, t]);

  return {
    isCloud, cloudConfig, currentModel, modelDraft, setModelDraft, pickerOptions, modelLoading, typeModel,
    savingModel, modelApplies, endpointHost, catalogFits, liveModels, liveLoading, liveError,
    accountModels, setManualEntry, modelLoadError, reload: () => setModelReload((value) => value + 1),
    handleModelChange,
  };
}

export type AgentModelOptions = ReturnType<typeof useAgentModelOptions>;
