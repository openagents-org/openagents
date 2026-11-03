import { useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { isUpgradeAvailable } from '../../shared/version-compare'
import type {
  AgentUpdateInfo,
  InstallPhase,
  InstalledAgentRecord,
  PrereqRemedy,
} from '../types'

export interface InstallJob {
  agent: string
  verb: 'install' | 'update' | 'uninstall' | 'rollback'
  phase: InstallPhase
  detail: string
  log: string
  error?: string
  /** Dependencies the machine is missing — the install never started. */
  missing?: PrereqRemedy[]
  /** Where the streamed output was written on disk. */
  logFile?: string
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
  if (!info) return false
  return isUpgradeAvailable(info.current, info.latest)
}

/**
 * Runs `onDone` once when `type` is uninstalled — a job that started after the
 * caller began watching it, so one left over from earlier does not count.
 *
 * `since` is memoised rather than set in an effect: a page hidden by
 * <Activity> re-runs its effects when it is shown again, which would move the
 * start past an uninstall that finished while it was hidden.
 */
export function useOnUninstalled(type: string | null | undefined, onDone: () => void): void {
  const job = useInstallStore((s) => (type ? s.jobs[type] : undefined))
  const since = useMemo(() => Date.now(), [type])
  const handled = useRef(0)
  const callback = useRef(onDone)
  callback.current = onDone
  useEffect(() => {
    if (!job || job.verb !== 'uninstall' || job.phase !== 'done') return
    if (job.startedAt < since || job.startedAt === handled.current) return
    handled.current = job.startedAt
    callback.current()
  }, [job, since])
}
