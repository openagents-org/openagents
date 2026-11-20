'use client';

import { useCallback, useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { nodeCommandErrorKey } from '@/lib/node-command-error';
import { useWorkspace } from '@/lib/workspace-context';
import type { AgentCatalogDetail, NodeCommand, WorkspaceAgent, WorkspaceNode } from '@/lib/types';
import { encryptAgentCredentials } from './encrypt-agent-credentials';

/** 'applied': the device finished it. 'queued': still on its way there. */
export type ConfigureOutcome = 'applied' | 'queued';

export type NodeAgentSettings = ReturnType<typeof useNodeAgentSettings>;

/** A working-folder change recreates the agent (and may install it), so wait up to a minute. */
async function waitForCommand(nodeId: string, commandId: string): Promise<NodeCommand | null> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const cmds = await workspaceApi.listNodeCommands(nodeId).catch((): NodeCommand[] => []);
    const c = cmds.find((x) => x.commandId === commandId);
    if (c && (c.status === 'done' || c.status === 'error')) return c;
  }
  return null;
}

/**
 * Whether a provider (Acenta) hosts this agent's runtime. Such an agent joins
 * through a connection of its own, so it carries a node id and a folder
 * (`/workspace` in the provider's sandbox), yet it has no device of yours,
 * folder or key to change. null until known.
 */
export function useHostedRuntime(agentName: string | undefined, enabled: boolean): boolean | null {
  const [hosted, setHosted] = useState<boolean | null>(null);
  useEffect(() => {
    setHosted(null);
    if (!enabled || !agentName) return;
    let cancelled = false;
    workspaceApi.listHostedAgents()
      .then((rows) => { if (!cancelled) setHosted(rows.some((h) => h.agentName === agentName)); })
      .catch(() => { if (!cancelled) setHosted(false); });
    return () => { cancelled = true; };
  }, [agentName, enabled]);
  return hosted;
}

/**
 * The device side of a node agent, for editing it in place from the profile:
 * what its device reports (folder, key, endpoint) and a `configure` that sends
 * configure_agent and waits for the device's answer. Keys go encrypted to the
 * device, as onboarding sends them. Loads only while `enabled` (agents you own).
 */
export function useNodeAgentSettings(agent: WorkspaceAgent | undefined, enabled: boolean) {
  const t = useT();
  const { refreshWorkspace } = useWorkspace();
  const [node, setNode] = useState<WorkspaceNode | null>(null);
  const [detail, setDetail] = useState<AgentCatalogDetail | null>(null);
  const agentName = agent?.agentName ?? '';
  const nodeId = agent?.nodeId ?? null;

  const load = useCallback(async () => {
    const nodes = await workspaceApi.listNodes().catch((): WorkspaceNode[] => []);
    setNode(nodes.find((n) => n.nodeId === nodeId && (n.agents || []).some((a) => a.name === agentName)) ?? null);
  }, [nodeId, agentName]);

  useEffect(() => {
    if (enabled && nodeId) void load();
    else setNode(null);
  }, [enabled, nodeId, load]);

  const nodeAgent = node?.agents.find((a) => a.name === agentName) ?? null;
  const type = nodeAgent?.type ?? null;
  useEffect(() => {
    setDetail(null);
    if (!type) return;
    let cancelled = false;
    workspaceApi.getAgentCatalogDetail(type).then((d) => { if (!cancelled) setDetail(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [type]);

  const configure = useCallback(async (args: Record<string, unknown>): Promise<ConfigureOutcome> => {
    if (!node || !nodeAgent) throw new Error(t('connect.nodeCommandFailed'));
    let payload: Record<string, unknown> = {
      name: agentName,
      type: nodeAgent.type,
      currentWorkingDir: nodeAgent.workingDir || agent?.workingDir || '',
      ...args,
    };
    if (payload.apiKey) {
      try {
        payload = await encryptAgentCredentials(workspaceApi, node.nodeId, 'configure_agent', payload, t('agentSetup.secureUnavailable'));
      } catch { throw new Error(t('agentSetup.secureUnavailable')); }
    }
    const { commandId } = await workspaceApi.enqueueNodeCommand(node.nodeId, 'configure_agent', payload);
    const done = commandId ? await waitForCommand(node.nodeId, commandId) : null;
    if (done && (done.status === 'error' || done.result?.ok === false)) {
      const message = done.result?.message || '';
      const key = nodeCommandErrorKey(message);
      throw new Error(key ? t(key, { name: agentName }) : message || t('connect.nodeCommandFailed'));
    }
    await load();
    refreshWorkspace();
    return done ? 'applied' : 'queued';
  }, [node, nodeAgent, agentName, agent?.workingDir, t, load, refreshWorkspace]);

  return { node, nodeAgent, detail, configure };
}
