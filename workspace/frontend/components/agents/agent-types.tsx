'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Agent name → agent type (claude, codex, cloud:openai…), so an avatar given
 * only a name can draw the agent's type icon. The workspace provides it from
 * its agent list; a view outside the workspace (the settings pages) provides
 * it from the agents it loaded itself.
 */
const AgentTypesContext = createContext<ReadonlyMap<string, string> | null>(null);

export interface AgentTypeEntry {
  agentName: string;
  agentType: string | null;
}

/** Nested providers add to the outer one rather than hiding it. */
export function AgentTypesProvider({ agents, children }: { agents: readonly AgentTypeEntry[]; children: ReactNode }) {
  const outer = useContext(AgentTypesContext);
  const types = useMemo(() => {
    const map = new Map(outer ?? []);
    for (const a of agents) if (a.agentType) map.set(a.agentName, a.agentType);
    return map;
  }, [outer, agents]);
  return <AgentTypesContext.Provider value={types}>{children}</AgentTypesContext.Provider>;
}

/** The type of the agent called `name`, or null when it is not known here. */
export function useAgentType(name: string): string | null {
  const types = useContext(AgentTypesContext);
  return types?.get(name.replace(/^openagents:/, '')) ?? null;
}
