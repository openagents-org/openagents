'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import type { NodeProbe } from '@/lib/types';

export type AgentProbeEntry = { probe: NodeProbe; nodeId: string };

/**
 * Per-agent smoke-test results ride the node heartbeat's roster. A failing
 * probe means a participant will likely never answer even though it shows
 * online — surface it in the thread BEFORE the user invests in a message.
 * Probes refresh hourly on the device, so a slow poll here is plenty.
 */
export function useAgentProbes() {
  const [agentProbes, setAgentProbes] = useState<Map<string, AgentProbeEntry>>(new Map());
  // Dismiss only this result in this thread; a new health check can warn again.
  const [dismissedProbes, setDismissedProbes] = useState<Set<string>>(new Set());
  const [retesting, setRetesting] = useState<Set<string>>(new Set());
  const loadProbes = useCallback(async () => {
    const nodes = await workspaceApi.listNodes();
    const m = new Map<string, AgentProbeEntry>();
    for (const n of nodes) {
      for (const a of n.agents || []) if (a.probe) m.set(a.name, { probe: a.probe, nodeId: n.nodeId });
    }
    setAgentProbes(m);
    return m;
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = () => loadProbes().catch(() => { /* transient — banner stays */ });
    load();
    const id = setInterval(() => { if (!cancelled) load(); }, 90_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [loadProbes]);

  // Re-run the smoke test on demand: enqueue probe_agent on the agent's node,
  // then fast-poll until a probe with a NEWER timestamp arrives (the daemon
  // picks the command up on its next poll and reports via heartbeat).
  const retestAgent = useCallback(async (name: string, nodeId: string, prevAt: string) => {
    setRetesting((s) => new Set(s).add(name));
    try {
      await workspaceApi.enqueueNodeCommand(nodeId, 'probe_agent', { name });
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const m = await loadProbes().catch(() => null);
        const fresh = m?.get(name);
        if (fresh && fresh.probe.at !== prevAt) return; // new verdict rendered
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRetesting((s) => { const n = new Set(s); n.delete(name); return n; });
    }
  }, [loadProbes]);

  const dismissProbe = useCallback((key: string) => {
    setDismissedProbes((previous) => new Set(previous).add(key));
  }, []);

  return { agentProbes, dismissedProbes, dismissProbe, retesting, retestAgent };
}
