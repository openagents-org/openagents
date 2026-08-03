import { useCallback, useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import { useAgentsStore } from "@renderer/store/agents"
import { useInstallStore } from "@renderer/store/install"
import { useConnectionsStore } from "@renderer/store/connections"
import type { Workspace } from "@renderer/types"

/** Agent list + core/launcher version poll. */
const AGENTS_POLL_MS = 5000
/** Workspace/message aggregates — expensive, so far less often. */
const AGGREGATES_POLL_MS = 60_000
const UPDATES_POLL_MS = 60 * 60 * 1000
/** Only aggregate the most recent workspaces; the full sweep is too costly. */
const AGGREGATE_WORKSPACE_LIMIT = 10
const AGGREGATE_MESSAGE_LIMIT = 100

export interface DashboardAggregates {
  workspaces: Workspace[]
  todayMessageCount: number
  /**
   * Last time each agent posted, as an ISO timestamp keyed by agent name. The
   * daemon tracks no per-agent activity of its own, so the newest message an
   * agent sent is the best "last active" the launcher can know.
   */
  lastActiveByAgent: Record<string, string>
  installedCount: number | undefined
}

interface DashboardData extends DashboardAggregates {
  loading: boolean
  /** Re-reads the agent list — what an agent action calls to confirm itself. */
  refresh: () => Promise<void>
}

/**
 * Owns every periodic fetch the dashboard needs: the agent list, the daily
 * message aggregates, and the agent-update check.
 */
export function useDashboardData(): DashboardData {
  const { agents, setAgents, setCoreVersion, setLauncherVersion } = useAgentsStore(
    useShallow((s) => ({
      agents: s.agents,
      setAgents: s.setAgents,
      setCoreVersion: s.setCoreVersion,
      setLauncherVersion: s.setLauncherVersion,
    })),
  )
  const setUpdates = useInstallStore((s) => s.setUpdates)
  const refreshConnections = useConnectionsStore((s) => s.refresh)

  const inFlight = useRef(false)
  const queued = useRef(false)
  const mounted = useRef(true)
  const [loading, setLoading] = useState(agents.length === 0)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [todayMessageCount, setTodayMessageCount] = useState(0)
  const [lastActiveByAgent, setLastActiveByAgent] = useState<
    Record<string, string>
  >({})
  const [installedCount, setInstalledCount] = useState<number | undefined>()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    // Coalesce overlapping refreshes: agent actions call this repeatedly while
    // polling for a state change, and the IPC round trip is slower than the gap.
    if (inFlight.current) {
      queued.current = true
      return
    }
    inFlight.current = true
    try {
      const data = await window.api.listAgents()
      if (!mounted.current) return
      setAgents(data)
      setLoading(false)

      const status = await window.api.pythonStatus()
      if (!mounted.current) return
      setCoreVersion(status.sdkVersion)
      setLauncherVersion(`v${status.launcherVersion}`)
    } catch (err) {
      console.error("Dashboard refresh error:", err)
    } finally {
      inFlight.current = false
      if (queued.current) {
        queued.current = false
        refresh()
      }
    }
  }, [setAgents, setCoreVersion, setLauncherVersion])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, AGENTS_POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  const loadAggregates = useCallback(async () => {
    try {
      const wsList = await window.api.listWorkspaces()
      if (mounted.current) setWorkspaces(wsList)

      const midnight = new Date()
      midnight.setHours(0, 0, 0, 0)
      const todayMs = midnight.getTime()
      let total = 0
      const lastActive: Record<string, string> = {}

      await Promise.all(
        wsList.slice(0, AGGREGATE_WORKSPACE_LIMIT).map(async (w) => {
          try {
            // Workspace-wide: per-conversation channels are where the traffic
            // actually is, so a default-channel read counts nothing.
            const msgs = await window.api.chatGetWorkspaceMessages(
              w.id,
              AGGREGATE_MESSAGE_LIMIT,
            )
            for (const m of msgs) {
              const at = m.createdAt ? new Date(m.createdAt).getTime() : 0
              if (at >= todayMs) total += 1
              // Only agent messages date an agent: a human writing to it says
              // nothing about when the agent itself last did something.
              if (m.senderType !== "agent" || !m.senderName || !at) continue
              const prev = lastActive[m.senderName]
              if (!prev || at > new Date(prev).getTime())
                lastActive[m.senderName] = m.createdAt!
            }
          } catch {}
        }),
      )
      if (mounted.current) {
        setTodayMessageCount(total)
        setLastActiveByAgent(lastActive)
      }

      try {
        const installed = await window.api.getInstalledAgents()
        if (mounted.current) setInstalledCount(installed.length)
      } catch {}
    } catch {}
  }, [])

  useEffect(() => {
    void loadAggregates()
    const id = setInterval(loadAggregates, AGGREGATES_POLL_MS)
    return () => clearInterval(id)
  }, [loadAggregates])

  // Never forced: the main process caches probes for an hour, and this poll is
  // happy to read that cache. The marketplace is where a user goes to demand a
  // fresh check.
  const loadUpdates = useCallback(async (): Promise<void> => {
    try {
      setUpdates(await window.api.checkAgentUpdates())
    } catch {
      /* offline / registry down — keep whatever we last knew */
    }
  }, [setUpdates])

  useEffect(() => {
    void loadUpdates()
    const id = setInterval(() => void loadUpdates(), UPDATES_POLL_MS)
    return () => clearInterval(id)
  }, [loadUpdates])

  return {
    loading,
    refresh,
    workspaces,
    todayMessageCount,
    lastActiveByAgent,
    installedCount,
  }
}
