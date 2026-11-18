'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { type AgentDraft } from '@/components/agents/agent-setup';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { nodeCommandErrorKey } from '@/lib/node-command-error';
import type { NodeAgent, WorkspaceNode } from '@/lib/types';
import { NodeAgentItem } from './node-agent-item';
import { NodePendingAgent } from './node-pending-agent';
import { NodeSummary } from './node-summary';
import { useAgentToggles } from './use-agent-toggles';

/** Optimistic Add-agent placeholder, optionally tied to its create command. */
export interface PendingAgent {
  name: string;
  type: string;
  at: number;
  commandId?: string;
  cmdStatus?: 'pending' | 'running' | 'done' | 'error';
  cmdMessage?: string | null;
  /** What the add was submitted with, so a failed one can be edited and retried. */
  draft?: AgentDraft;
}

/**
 * One device in the workspace: a summary row, and — expanded — its agents to
 * start, stop, edit, share and remove, with the agents being added on top.
 */
export function NodeCard({
  node,
  isThisComputer = false,
  pending = [],
  expanded,
  onExpand,
  onAddAgent,
  onEditAgent,
  onDismissPending,
  onRetryPending,
  onChanged,
}: {
  node: WorkspaceNode;
  /** The computer this desktop app runs on, as registered in this workspace. */
  isThisComputer?: boolean;
  pending?: PendingAgent[];
  expanded: boolean;
  onExpand: () => void;
  onAddAgent: () => void;
  onEditAgent: (agent: NodeAgent) => void;
  /** Drop a placeholder whose create failed — nothing was made on the device. */
  onDismissPending: (name: string) => void;
  /** Reopen the add form from a failed placeholder, to fix it and try again. */
  onRetryPending: (pending: PendingAgent) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const online = node.status === 'online';
  const roster = node.agents || [];
  // Optimistic placeholders for agents being created but not yet reported in the
  // roster, so the user sees them spinning up immediately.
  const pendingAgents = pending.filter((p) => !roster.some((a) => a.name === p.name));

  // An agent added here keeps the place its placeholder had, at the top. The
  // roster lists agents in the device's config order, newest last, so the card
  // used to jump below every older agent the moment it reported in.
  const addedHereRef = useRef<string[]>([]);
  for (const p of pending) if (!addedHereRef.current.includes(p.name)) addedHereRef.current.push(p.name);
  const agents = useMemo(() => {
    const added = addedHereRef.current;
    const rank = (name: string) => { const i = added.indexOf(name); return i === -1 ? added.length : i; };
    return roster.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a.name) - rank(y.a.name) || x.i - y.i).map(({ a }) => a);
  }, [roster, pending]);

  // Re-render while placeholders wait, so one that stalls says so unprompted.
  const [, setPendingTick] = useState(0);
  useEffect(() => {
    if (pendingAgents.length === 0) return;
    const id = setInterval(() => setPendingTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [pendingAgents.length]);

  const agentStatusLabel = (status: string) => online
    ? t(status === 'running' ? 'connect.nodeAgentStatusRunning'
      : status === 'error' ? 'connect.nodeAgentStatusError' : 'connect.nodeAgentStatusStopped')
    : t(status === 'running' ? 'connect.nodeAgentLastReportedRunning' : 'connect.nodeAgentLastReportedStopped');

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

  const { toggling, toggleAgent } = useAgentToggles({ node, agents, isThisComputer, onChanged });

  const queue = async (
    action: 'remove_agent',
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
      const key = nodeCommandErrorKey(msg);
      toast.error(key ? t(key, { name: String(args.name ?? '') }) : t('connect.nodeCommandFailed'));
    } finally {
      setBusy(false);
    }
  };

  const hasAny = agents.length > 0 || pendingAgents.length > 0;

  return (
    <div className="overflow-hidden rounded-xl border bg-background transition-shadow hover:shadow-xs">
      <NodeSummary
        node={node}
        agents={agents}
        isThisComputer={isThisComputer}
        expanded={expanded}
        busy={busy}
        agentStatusLabel={agentStatusLabel}
        onExpand={onExpand}
        onRemove={handleRemoveNode}
      />

      {/* Expanded: the device's agents and the way to add one. */}
      {expanded && (
        <div id={`device-agents-${node.nodeId}`} className="flex flex-col gap-3 border-t bg-muted/50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{t('connect.nodeAgents')}</span>
            {hasAny && (
              <Button size="lg" className="px-4 shadow-sm has-data-[icon=inline-start]:pl-3" onClick={onAddAgent}>
                <Plus data-icon="inline-start" />{t('connect.nodeAddAgent')}
              </Button>
            )}
          </div>

          {!online && <p className="text-xs text-warning">{t('connect.nodeOfflineActionHint')}</p>}

          {!hasAny ? (
            <Empty className="p-4">
              <EmptyHeader>
                <EmptyDescription>{t(online ? 'connect.nodeAddFirstAgentHint' : 'connect.nodeNoAgents')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={onAddAgent}>
                  <Plus data-icon="inline-start" />{t('connect.nodeAddAgent')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div role="list" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {pendingAgents.map((p) => (
                <NodePendingAgent
                  key={`pending-${p.name}`}
                  pending={p}
                  onRetry={() => onRetryPending(p)}
                  onDismiss={() => onDismissPending(p.name)}
                />
              ))}
              {agents.map((a) => (
                <NodeAgentItem
                  key={a.name}
                  agent={a}
                  online={online}
                  busy={busy}
                  toggling={toggling[a.name]}
                  statusLabel={agentStatusLabel(a.status)}
                  onToggle={(action) => void toggleAgent(a, action)}
                  onEdit={() => onEditAgent(a)}
                  onRemove={() => void queue('remove_agent', { name: a.name })}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
