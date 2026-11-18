'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLayout, type EditAgentRequest } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import type { NodeAgent, WorkspaceNode } from '@/lib/types';

/**
 * Requests other views leave for the devices tab: the sidebar's "+" beside
 * Agents (open a device's gallery) and "Change in settings" on an agent's
 * profile (open that agent's full form). Both wait for the node list.
 */
export function useConnectRequests({ nodes, loaded, localNodeId, onRefresh, openGallery, openEditor }: {
  nodes: WorkspaceNode[];
  /** A node load has finished at least once. */
  loaded: boolean;
  localNodeId: string | null;
  onRefresh: () => void | Promise<void>;
  openGallery: (nodeId: string) => void;
  openEditor: (nodeId: string, agent: NodeAgent) => void;
}) {
  const t = useT();
  const { addAgentPending, consumeAddAgent, editAgentPending, consumeEditAgent } = useLayout();

  // This computer first; with no device yet the list itself (and its pairing
  // step) is the right place to land.
  useEffect(() => {
    if (!addAgentPending || !loaded) return;
    consumeAddAgent();
    const online = nodes.filter((n) => n.status === 'online');
    const target = online.find((n) => n.nodeId === localNodeId) || online[0] || nodes[0];
    if (target) openGallery(target.nodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addAgentPending, consumeAddAgent, loaded, nodes, localNodeId]);

  // The list on hand may predate the agent (the tab kept an old snapshot), so
  // one that lacks it is fetched again before the request gives up.
  const [refetchedFor, setRefetchedFor] = useState<EditAgentRequest | null>(null);
  const [refetching, setRefetching] = useState<EditAgentRequest | null>(null);
  useEffect(() => {
    const request = editAgentPending;
    if (!request || !loaded || refetching === request) return;
    const node = nodes.find((n) => n.nodeId === request.nodeId);
    const agent = node?.agents?.find((a) => a.name === request.agentName);
    if (node && agent) {
      consumeEditAgent();
      openEditor(node.nodeId, agent);
      return;
    }
    if (refetchedFor !== request) {
      setRefetching(request);
      void Promise.resolve(onRefresh()).finally(() => { setRefetching(null); setRefetchedFor(request); });
      return;
    }
    consumeEditAgent();
    // The list holds only this person's device connections: a missing node
    // belongs to someone else, who alone can change its agents.
    toast.error(node
      ? t('connect.editAgentNotFound', { name: request.agentName })
      : t('connect.agentOnOtherConnection', { name: request.agentName }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAgentPending, consumeEditAgent, loaded, nodes, refetchedFor, refetching, t]);
}

/** An add that came up says so, with the way to the agent it made. */
export function useJoinedNotice(skip: boolean): (agentName: string) => void {
  const t = useT();
  const { setSelectedAgentName } = useLayout();
  const { refreshAgents } = useWorkspace();
  return (name) => {
    if (skip) return;
    toast.success(t('connect.agentJoined', { name }), {
      // The profile reads the workspace's agent list, which may not have it yet.
      action: { label: t('connect.viewAgent'), onClick: () => { void refreshAgents().finally(() => setSelectedAgentName(name)); } },
    });
  };
}
