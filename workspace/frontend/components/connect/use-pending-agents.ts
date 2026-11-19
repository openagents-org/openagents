'use client';
import { useEffect, useRef, useState } from 'react';
import type { AgentDraft } from '@/components/agents/agent-setup';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceNode } from '@/lib/types';
import type { PendingAgent } from './node-card';
import { readDismissed, recoverPending, rememberDismissed } from './pending-recovery';

/**
 * Agents being added, per device, until the device's roster reports them.
 * A page opened later (a refresh, another tab, another view) rebuilds them
 * from each device's command history, so an add in progress or a failed one
 * is never lost with the page. `onJoined` hears of each one that came up.
 */
export function usePendingAgents(nodes: WorkspaceNode[], onJoined?: (agentName: string) => void) {
  // Optimistic "spinning up" agents per node, until the real roster reports
  // them. `at` is the creation timestamp; `commandId` ties the placeholder to
  // the create_agent command so its display tracks the REAL install/config
  // progress (a queued openclaw install can legitimately take minutes — a
  // blind timer used to flip to "not up yet" mid-install and send the user
  // off to debug a healthy device).
  const [pending, setPending] = useState<Record<string, PendingAgent[]>>({});

  const addPending = (nodeId: string, agent: { name: string; type: string; commandId?: string; draft?: AgentDraft }) => {
    setPending((prev) => ({ ...prev, [nodeId]: [...(prev[nodeId] || []).filter((p) => p.name !== agent.name), { ...agent, at: Date.now() }] }));
  };

  // Removing a card is final: its command must not bring it back on the next
  // visit. A retry removes the failed one too, and its new command replaces it.
  const removePending = (nodeId: string, name: string) =>
    setPending((prev) => {
      const gone = (prev[nodeId] || []).find((p) => p.name === name);
      if (gone?.commandId) rememberDismissed(gone.commandId);
      const kept = (prev[nodeId] || []).filter((p) => p.name !== name);
      const next = { ...prev };
      if (kept.length) next[nodeId] = kept;
      else delete next[nodeId];
      return next;
    });

  // Once per device per page: what its command history says is in flight.
  // The newest roster is read when the history lands, so an agent that joined
  // meanwhile gets neither a card nor a "joined" notice.
  const recoveredRef = useRef(new Set<string>());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  useEffect(() => {
    for (const node of nodes) {
      if (recoveredRef.current.has(node.nodeId)) continue;
      // Marked before the fetch and never cleared: a history that cannot be
      // read is not asked for again on every 10s list poll.
      recoveredRef.current.add(node.nodeId);
      // The most the server returns: an add can sit behind many later
      // start/stop/model commands.
      workspaceApi.listNodeCommands(node.nodeId, 100).then((cmds) => {
        const latest = nodesRef.current.find((n) => n.nodeId === node.nodeId) ?? node;
        const found = recoverPending(cmds, latest.agents || [], readDismissed());
        if (!found.length) return;
        setPending((prev) => {
          const have = prev[node.nodeId] || [];
          const added = found.filter((p) => !have.some((h) => h.name === p.name));
          return added.length ? { ...prev, [node.nodeId]: [...have, ...added] } : prev;
        });
      }).catch(() => {});
    }
  }, [nodes]);

  // Drop placeholders once the node's real roster includes them.
  const joinedRef = useRef<string[]>([]);
  useEffect(() => {
    setPending((prev) => {
      let changed = false;
      const next: Record<string, PendingAgent[]> = {};
      for (const [nodeId, list] of Object.entries(prev)) {
        const node = nodes.find((n) => n.nodeId === nodeId);
        const roster = node?.agents || [];
        const kept = list.filter((p) => !roster.some((a) => a.name === p.name));
        if (kept.length !== list.length) {
          changed = true;
          for (const p of list) if (!kept.includes(p)) joinedRef.current.push(p.name);
        }
        if (kept.length) next[nodeId] = kept;
      }
      return changed ? next : prev;
    });
  }, [nodes]);
  // Reported outside the state updater, which React may run twice.
  const onJoinedRef = useRef(onJoined);
  onJoinedRef.current = onJoined;
  useEffect(() => {
    const joined = [...new Set(joinedRef.current)];
    joinedRef.current = [];
    for (const name of joined) onJoinedRef.current?.(name);
  }, [pending]);

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

  return { pending, addPending, removePending };
}
