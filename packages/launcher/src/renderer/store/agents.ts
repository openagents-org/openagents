import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Agent } from '../types'

export type AgentsSummaryState = 'running' | 'starting' | 'error' | 'stopped' | 'none'

interface AgentsState {
  agents: Agent[]
  setAgents: (agents: Agent[]) => void

  pendingAgentActions: Set<string>
  addPendingAction: (name: string) => void
  removePendingAction: (name: string) => void

  coreVersion: string | null
  setCoreVersion: (v: string | null) => void
  launcherVersion: string | null
  setLauncherVersion: (v: string | null) => void

  coreUpdateInfo: { current: string; latest: string } | null
  setCoreUpdateInfo: (info: { current: string; latest: string } | null) => void
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  setAgents: (agents) => set({ agents }),

  pendingAgentActions: new Set<string>(),
  addPendingAction: (name) =>
    set((state) => ({ pendingAgentActions: new Set(state.pendingAgentActions).add(name) })),
  removePendingAction: (name) =>
    set((state) => {
      const next = new Set(state.pendingAgentActions)
      next.delete(name)
      return { pendingAgentActions: next }
    }),

  coreVersion: null,
  setCoreVersion: (v) => set({ coreVersion: v }),
  launcherVersion: null,
  setLauncherVersion: (v) => set({ launcherVersion: v }),

  coreUpdateInfo: null,
  setCoreUpdateInfo: (info) => set({ coreUpdateInfo: info }),
}))

/**
 * What this computer's agents are doing, as one line for the status footer.
 *
 * It describes the agents, not the daemon, because the agent list is all it
 * reads. It used to be worded as daemon health, so a device whose only agent
 * had failed said "Daemon stopped" while the daemon ran fine.
 *
 * running  — `count` agents are online/running/idle
 * starting — none running, `count` starting/reconnecting
 * error    — none running or starting, `count` in error
 * stopped  — agents exist, none of the above
 * none     — no agents on this computer
 */
export interface AgentsSummary {
  state: AgentsSummaryState
  count: number
}

const RUNNING = ['online', 'running', 'idle']
const STARTING = ['starting', 'reconnecting']

export function summarizeAgents(agents: Pick<Agent, 'state'>[]): AgentsSummary {
  const count = (states: string[]): number => agents.filter((a) => states.includes(a.state)).length
  const running = count(RUNNING)
  if (running > 0) return { state: 'running', count: running }
  const starting = count(STARTING)
  if (starting > 0) return { state: 'starting', count: starting }
  const failed = count(['error'])
  if (failed > 0) return { state: 'error', count: failed }
  return { state: agents.length > 0 ? 'stopped' : 'none', count: 0 }
}

export function useAgentsSummary(): AgentsSummary {
  return useAgentsStore(useShallow((s) => summarizeAgents(s.agents)))
}
