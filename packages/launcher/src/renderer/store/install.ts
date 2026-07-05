import { create } from 'zustand'
import type { AgentUpdateInfo, InstallPhase, InstalledAgentRecord } from '../types'

export interface InstallJob {
  agent: string
  verb: 'install' | 'update' | 'uninstall' | 'rollback'
  phase: InstallPhase
  detail: string
  log: string
  error?: string
  startedAt: number
}

interface InstallState {
  jobs: Record<string, InstallJob>
  startJob: (job: Omit<InstallJob, 'startedAt' | 'log' | 'detail' | 'phase'> & {
    phase?: InstallPhase
    detail?: string
  }) => void
  updateJob: (agent: string, patch: Partial<InstallJob>) => void
  appendLog: (agent: string, chunk: string) => void
  clearJob: (agent: string) => void

  installed: InstalledAgentRecord[]
  setInstalled: (recs: InstalledAgentRecord[]) => void

  updates: AgentUpdateInfo[]
  setUpdates: (updates: AgentUpdateInfo[]) => void
}

export const useInstallStore = create<InstallState>((set) => ({
  jobs: {},
  startJob: (j) =>
    set((state) => ({
      jobs: {
        ...state.jobs,
        [j.agent]: {
          agent: j.agent,
          verb: j.verb,
          phase: j.phase || 'preparing',
          detail: j.detail || 'Starting…',
          log: '',
          startedAt: Date.now(),
        },
      },
    })),
  updateJob: (agent, patch) =>
    set((state) => {
      const existing = state.jobs[agent]
      if (!existing) return state
      return { jobs: { ...state.jobs, [agent]: { ...existing, ...patch } } }
    }),
  appendLog: (agent, chunk) =>
    set((state) => {
      const existing = state.jobs[agent]
      if (!existing) return state
      const next = (existing.log + chunk).slice(-20000)
      return { jobs: { ...state.jobs, [agent]: { ...existing, log: next } } }
    }),
  clearJob: (agent) =>
    set((state) => {
      const next = { ...state.jobs }
      delete next[agent]
      return { jobs: next }
    }),

  installed: [],
  setInstalled: (recs) => set({ installed: recs }),

  updates: [],
  setUpdates: (updates) => set({ updates }),
}))

// Expose the install store for E2E diagnostics (read an agent's streamed install
// log). Harmless in production; used by the launcher-agent-e2e harness.
if (typeof window !== "undefined") {
  ;(
    window as unknown as { __oaInstallStore?: typeof useInstallStore }
  ).__oaInstallStore = useInstallStore
}

export function hasPendingUpdate(updates: AgentUpdateInfo[], name: string): boolean {
  const info = updates.find((u) => u.name === name)
  if (!info || !info.current || !info.latest) return false
  return info.current !== info.latest
}
