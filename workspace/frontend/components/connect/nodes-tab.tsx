'use client';
import { useState, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { desktopHost } from '@/lib/desktop-host';
import { type CatalogState } from '@/components/agents/agent-setup';
import { DesktopComputerStep } from './desktop-computer-step';
import { useLocalNodeId } from './use-local-node-id';
import type { AgentCatalogEntry, CloudAgentProvider, WorkspaceNode, PairingCode } from '@/lib/types';
import { NodeCard, PendingAgent } from './node-card';
import { PairAnotherDevice } from './pair-another-device';
import { usePendingAgents } from './use-pending-agents';
import { useConnectRequests, useJoinedNotice } from './use-connect-requests';
import { WorkspaceAgentSetup } from './workspace-agent-setup';
import { NodesRoster } from './nodes-roster';

// ---------------------------------------------------------------------------
// Add-agent gallery — pick an agent type to run on a node
// ---------------------------------------------------------------------------

export function NodesTab({
  nodes,
  catalog,
  catalogState,
  cloudProviders,
  autoAddAgent = false,
  preferredNodeId,
  onFirstAgentCreated,
  pairedNodeId,
  onAgentJoined,
  loading,
  loaded,
  loadFailed = false,
  pairing,
  pairingLoading,
  pairingError,
  onGenerate,
  onDismissPairing,
  onRefresh,
}: {
  nodes: WorkspaceNode[];
  catalog: AgentCatalogEntry[];
  catalogState: CatalogState;
  cloudProviders: CloudAgentProvider[];
  autoAddAgent?: boolean;
  preferredNodeId?: string;
  onFirstAgentCreated?: (agentName: string) => void;
  /** The device a pairing code from this view was just redeemed by. */
  pairedNodeId?: string | null;
  /** That device brought an agent along (`agn join`): go talk to it. */
  onAgentJoined?: (agentName: string) => void;
  loading: boolean;
  /** A node load has finished at least once. */
  loaded: boolean;
  loadFailed?: boolean;
  pairing: PairingCode | null;
  pairingLoading: boolean;
  pairingError: boolean;
  onGenerate: () => void;
  onDismissPairing: () => void;
  onRefresh: () => void | Promise<void>;
}) {
  const t = useT();
  const { workspace } = useWorkspace();
  const host = desktopHost();
  // In the desktop app the device list offers the same choice as first-run
  // onboarding — this computer first, another device second — instead of
  // going straight to a pairing code meant for a different machine.
  const canConnectHere = !!host?.getComputerStatus && !!workspace;
  const [choosing, setChoosing] = useState(false);
  const [showDeviceSetup, setShowDeviceSetup] = useState(false);
  const previousPairing = useRef(pairing);
  useEffect(() => {
    if (previousPairing.current && !pairing) setShowDeviceSetup(false);
    previousPairing.current = pairing;
  }, [pairing]);
  const [joinedNodeId, setJoinedNodeId] = useState<string | null>(null);
  const localNodeId = useLocalNodeId(workspace?.workspaceId, joinedNodeId ?? nodes.length);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  // Keep one roster visible, including after loading, removal, or returning
  // from the gallery. Prefer a device ready for its first agent.
  const expandedNode = nodes.find((node) => node.nodeId === expandedNodeId)
    || nodes.find((node) => node.nodeId === preferredNodeId)
    || nodes.find((node) => node.status === 'online' && !node.agents?.length)
    || nodes.find((node) => node.status === 'online')
    || nodes[0];
  useEffect(() => {
    setExpandedNodeId(expandedNode?.nodeId ?? null);
  }, [expandedNode?.nodeId]);

  const [addingNodeId, setAddingNodeId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ nodeId: string; agent: import('@/lib/types').NodeAgent } | null>(null);
  const [retrying, setRetrying] = useState<{ nodeId: string; pending: PendingAgent } | null>(null);
  // Onboarding opens a thread with a new agent instead of announcing it.
  const announceJoined = useJoinedNotice(autoAddAgent);
  const { pending, addPending: queuePending, removePending } = usePendingAgents(nodes, announceJoined);
  // A new agent's device opens to show it spinning up.
  const addPending = (nodeId: string, agent: Parameters<typeof queuePending>[1]) => {
    setExpandedNodeId(nodeId);
    queuePending(nodeId, agent);
  };

  // Onboarding step 3: jump straight into the agent gallery for the connected
  // node (once), so the user picks an agent immediately instead of hunting for
  // the "Add agent" button.
  const autoAddedRef = useRef(false);
  useEffect(() => {
    if (!autoAddAgent || autoAddedRef.current) return;
    if (pairedNodeId) {
      // The device just paired here. Wait for its first heartbeat, which lists
      // the agents it runs: one connected by `agn join` from inside Claude
      // Code or Codex brings its agent along, so open a thread with that
      // agent instead of the gallery.
      const paired = nodes.find((n) => n.nodeId === pairedNodeId && n.status === 'online');
      if (!paired) return;
      autoAddedRef.current = true;
      const joined = (paired.agents || [])[0];
      if (joined) (onAgentJoined ?? onFirstAgentCreated)?.(joined.name);
      else setAddingNodeId(paired.nodeId);
      return;
    }
    const target = preferredNodeId
      ? nodes.find((n) => n.nodeId === preferredNodeId && n.status === 'online')
      : nodes.find((n) => (n.agents || []).length === 0) || nodes[0];
    if (target) { autoAddedRef.current = true; setAddingNodeId(target.nodeId); }
  }, [autoAddAgent, nodes, preferredNodeId, pairedNodeId, onFirstAgentCreated, onAgentJoined]);

  // Requests from the sidebar and the agent profile. Each opens one screen,
  // so it closes whichever form (add, retry, edit) was left open.
  useConnectRequests({
    nodes,
    loaded,
    localNodeId,
    onRefresh,
    openGallery: (nodeId) => {
      setEditing(null);
      setRetrying(null);
      setExpandedNodeId(nodeId);
      setAddingNodeId(nodeId);
    },
    openEditor: (nodeId, agent) => {
      setAddingNodeId(null);
      setRetrying(null);
      setExpandedNodeId(nodeId);
      setEditing({ nodeId, agent });
    },
  });

  // This computer just joined and came online: open its agent picker as soon
  // as the list (polled) has it, the same next step as first-run onboarding.
  useEffect(() => {
    if (!joinedNodeId) return;
    if (!nodes.some((n) => n.nodeId === joinedNodeId && n.status === 'online')) return;
    setJoinedNodeId(null);
    setChoosing(false);
    setExpandedNodeId(joinedNodeId);
    setAddingNodeId(joinedNodeId);
  }, [joinedNodeId, nodes]);

  // A choice made in one workspace does not carry over to the next.
  useEffect(() => {
    setChoosing(false);
    setJoinedNodeId(null);
  }, [workspace?.workspaceId]);

  // The gallery works on live node data (runtimes refresh via polling), so look
  // the node up by id each render rather than snapshotting it.
  const addingNode = addingNodeId ? nodes.find((n) => n.nodeId === addingNodeId) : null;
  if (addingNode) {
    return (
      <WorkspaceAgentSetup
        node={addingNode}
        onManageAgent={(agent) => { setAddingNodeId(null); setEditing({ nodeId: addingNode.nodeId, agent }) }}
        catalog={catalog}
        catalogState={catalogState}
        cloudProviders={cloudProviders}
        onBack={() => setAddingNodeId(null)}
        onChanged={onRefresh}
        onQueued={(agent) => {
          addPending(addingNode.nodeId, agent);
          // Onboarding first agent → open a thread with it once it joins.
          if (autoAddAgent) onFirstAgentCreated?.(agent.name);
        }}
      />
    );
  }

  // Edit on a failed placeholder: the add form, filled in as it was submitted.
  // The retry replaces the failed card (under its new name, if renamed).
  const retryingNode = retrying ? nodes.find((n) => n.nodeId === retrying.nodeId) : null;
  if (retrying && retryingNode && retrying.pending.draft) {
    return (
      <WorkspaceAgentSetup
        key={`retry-${retrying.pending.name}-${retrying.pending.at}`}
        node={retryingNode}
        catalog={catalog}
        catalogState={catalogState}
        cloudProviders={cloudProviders}
        draft={retrying.pending.draft}
        draftFailure={retrying.pending.cmdMessage}
        onManageAgent={(agent) => { setRetrying(null); setEditing({ nodeId: retryingNode.nodeId, agent }) }}
        onBack={() => setRetrying(null)}
        onChanged={onRefresh}
        onQueued={(agent) => {
          removePending(retryingNode.nodeId, retrying.pending.name);
          addPending(retryingNode.nodeId, agent);
          // Onboarding waits for the first agent by name — a renamed retry is
          // the one that will join, not the name that failed.
          if (autoAddAgent) onFirstAgentCreated?.(agent.name);
        }}
      />
    );
  }

  const editingNode = editing ? nodes.find((n) => n.nodeId === editing.nodeId) : null;
  if (editing && editingNode) {
    return (
      <WorkspaceAgentSetup
        key={`edit-${editing.agent.name}`}
        node={editingNode}
        catalog={catalog}
        catalogState={catalogState}
        cloudProviders={cloudProviders}
        editAgent={editing.agent}
        onBack={() => setEditing(null)}
        onChanged={onRefresh}
      />
    );
  }

  // Connecting another device is its own screen. Keep the existing device
  // roster out of the way while the pairing code is waiting to be redeemed.
  if (showDeviceSetup || pairing) {
    return (
      <PairAnotherDevice
        pairing={pairing}
        pairingError={pairingError}
        pairingLoading={pairingLoading}
        onBack={() => { setShowDeviceSetup(false); onDismissPairing(); }}
        onGenerate={onGenerate}
      />
    );
  }

  const listReady = !(loading && nodes.length === 0) && !(loadFailed && nodes.length === 0);
  if (canConnectHere && listReady && !pairing && (nodes.length === 0 || choosing)) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-7">
        {nodes.length > 0 && (
          <button
            onClick={() => setChoosing(false)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="size-3.5 rotate-180" />{t('connect.nodeBack')}
          </button>
        )}
        <DesktopComputerStep
          key={workspace!.workspaceId}
          host={host!}
          workspaceId={workspace!.workspaceId}
          workspaceName={workspace!.name}
          onConnected={(nodeId) => { setJoinedNodeId(nodeId); onRefresh(); }}
          onOtherDevice={() => { setChoosing(false); onGenerate(); }}
        />
      </div>
    );
  }

  return (
    <NodesRoster
      empty={nodes.length === 0}
      loading={loading}
      loadFailed={loadFailed}
      pairingLoading={pairingLoading}
      onConnectAnother={canConnectHere ? () => setChoosing(true) : () => { setShowDeviceSetup(true); onGenerate(); }}
      onGenerate={onGenerate}
      onRefresh={onRefresh}
    >
      {nodes.map((node) => (
        <NodeCard
          key={node.nodeId}
          node={node}
          isThisComputer={!!localNodeId && node.nodeId === localNodeId}
          expanded={node.nodeId === expandedNode?.nodeId}
          onExpand={() => setExpandedNodeId(node.nodeId)}
          pending={pending[node.nodeId] || []}
          onAddAgent={() => { setExpandedNodeId(node.nodeId); setAddingNodeId(node.nodeId); }}
          onEditAgent={(agent) => setEditing({ nodeId: node.nodeId, agent })}
          onDismissPending={(name) => removePending(node.nodeId, name)}
          onRetryPending={(p) => setRetrying({ nodeId: node.nodeId, pending: p })}
          onChanged={onRefresh}
        />
      ))}
    </NodesRoster>
  );
}
