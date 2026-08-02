import { useCallback, useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import { useAgentsStore } from "@renderer/store/agents"
import { useInstallStore } from "@renderer/store/install"
import { useConnectionsStore } from "@renderer/store/connections"

/** Agent list + core/launcher version poll. */
const AGENTS_POLL_MS = 5000
/** Workspace/message aggregates — expensive, so far less often. */
const AGGREGATES_POLL_MS = 60_000
const UPDATES_POLL_MS = 60 * 60 * 1000
/** Only aggregate the most recent workspaces; the full sweep is too costly. */
const AGGREGATE_WORKSPACE_LIMIT = 10
const AGGREGATE_MESSAGE_LIMIT = 100

export interface DashboardAggregates {
  workspaceCount: number
  todayMessageCount: number
  todayByAgent: Record<string, number>
  installedCount: number | undefined
}

interface DashboardData extends DashboardAggregates {
  loading: boolean
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
  const [workspaceCount, setWorkspaceCount] = useState(0)
  const [todayMessageCount, setTodayMessageCount] = useState(0)
  const [todayByAgent, setTodayByAgent] = useState<Record<string, number>>({})
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
      if (mounted.current) setWorkspaceCount(wsList.length)

      const midnight = new Date()
      midnight.setHours(0, 0, 0, 0)
      const todayMs = midnight.getTime()
      let total = 0
      const byAgent: Record<string, number> = {}

      await Promise.all(
        wsList.slice(0, AGGREGATE_WORKSPACE_LIMIT).map(async (w) => {
          try {
            const msgs = await window.api.chatGetMessages(
              w.id,
              undefined,
              AGGREGATE_MESSAGE_LIMIT,
            )
            for (const m of msgs) {
              const at = m.createdAt ? new Date(m.createdAt).getTime() : 0
              if (at < todayMs) continue
              total += 1
              const sender = (m as unknown as { sender?: string }).sender
              if (sender) byAgent[sender] = (byAgent[sender] || 0) + 1
            }
          } catch {}
        }),
      )
      if (mounted.current) {
        setTodayMessageCount(total)
        setTodayByAgent(byAgent)
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

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const u = await window.api.checkAgentUpdates()
        if (!cancelled) setUpdates(u)
      } catch {}
    }
    load()
    const id = setInterval(load, UPDATES_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [setUpdates])

  return {
    loading,
    refresh,
    workspaceCount,
    todayMessageCount,
    todayByAgent,
    installedCount,
  }
}
