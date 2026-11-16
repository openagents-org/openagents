'use client';
import { useEffect, useState } from 'react';
import type { AgentDraft } from '@/components/agents/agent-setup';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceNode } from '@/lib/types';
import type { PendingAgent } from './node-card';

/**
 * Agents being added, per device, until the device's roster reports them.
 */
export function usePendingAgents(nodes: WorkspaceNode[]) {
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

  const removePending = (nodeId: string, name: string) =>
    setPending((prev) => {
      const kept = (prev[nodeId] || []).filter((p) => p.name !== name);
      const next = { ...prev };
      if (kept.length) next[nodeId] = kept;
      else delete next[nodeId];
      return next;
    });

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

  return { pending, addPending, removePending };
}
