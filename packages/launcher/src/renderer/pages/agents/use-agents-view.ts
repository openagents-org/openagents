import { useEffect, useMemo, useRef, useState } from "react"

import type { Agent } from "@renderer/types"
import { deriveModel } from "@renderer/lib/agent-model"
import { stateKeyOf, type StateKey } from "@renderer/lib/agent-state"
import { useAgentActivity } from "./use-agent-activity"

export const AGENT_FILTERS = ["all", "running", "error", "disconnected"] as const
export type AgentFilter = (typeof AGENT_FILTERS)[number]

export const AGENT_SORTS = ["recent", "name", "status"] as const
export type AgentSort = (typeof AGENT_SORTS)[number]

export const AGENT_VIEWS = ["list", "grid"] as const
export type AgentView = (typeof AGENT_VIEWS)[number]

export const PAGE_SIZES = [10, 20, 50] as const

/** The list shows the same five process states the dashboard does. */
export type AgentStatus = StateKey

export interface AgentRow {
  agent: Agent
  /** Catalog display name for the agent type, e.g. "Claude Code". */
  providerLabel: string
  /** Model taken from the agent's own env; null when it never set one. */
  model: string | null
  /** How the agent authenticates, once a health check has reported it. */
  auth: "api_key" | "cli_login" | null
  workspace: string | null
  /** What the process is doing. Membership is `connected`, not a status. */
  status: AgentStatus
  /** Whether the agent belongs to a workspace at all. */
  connected: boolean
  lastActiveAt: string | null
}

export interface AgentsView {
  rows: AgentRow[]
  /** The current page of `rows`. */
  pageRows: AgentRow[]
  counts: Record<AgentFilter, number>
  page: number
  pageCount: number
  setPage: (p: number) => void
  pageSize: number
  setPageSize: (n: number) => void
}

/**
 * Everything the list needs on top of the raw agent array: the display fields
 * the table columns show, the filter counters, and paging.
 */
export function useAgentsView(
  agents: Agent[],
  search: string,
  filter: AgentFilter,
  sort: AgentSort,
): AgentsView {
  const lastActive = useAgentActivity()
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The catalog is cached in main and only changes when an agent type is
  // installed, so once per mount is enough.
  useEffect(() => {
    window.api
      .getCatalog()
      .then((entries) => {
        if (!mounted.current) return
        const next: Record<string, string> = {}
        for (const e of entries) if (e.label) next[e.name] = e.label
        setLabels(next)
      })
      .catch(() => {})
  }, [])

  const allRows = useMemo<AgentRow[]>(
    () =>
      agents.map((agent) => ({
        agent,
        providerLabel: labels[agent.type] || agent.type,
        model: deriveModel(agent),
        auth: agent.health?.auth_mode === "api_key"
          ? "api_key"
          : agent.health?.auth_mode === "cli_login"
            ? "cli_login"
            : null,
        workspace: agent.networkName || agent.network || null,
        status: stateKeyOf(agent),
        connected: !!agent.network,
        lastActiveAt: lastActive[agent.name] || null,
      })),
    [agents, labels, lastActive],
  )

  const counts = useMemo<Record<AgentFilter, number>>(() => {
    const c: Record<AgentFilter, number> = {
      all: allRows.length,
      running: 0,
      error: 0,
      disconnected: 0,
    }
    for (const r of allRows) {
      if (r.status === "running" || r.status === "idle") c.running += 1
      else if (r.status === "error") c.error += 1
      if (!r.connected) c.disconnected += 1
    }
    return c
  }, [allRows])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = allRows.filter((r) => {
      // "disconnected" asks about membership, the others about the process —
      // an agent with no workspace can still be running, and both tabs are
      // entitled to it.
      if (filter !== "all") {
        const inTab =
          filter === "disconnected"
            ? !r.connected
            : filter === "running"
              ? r.status === "running" || r.status === "idle"
              : r.status === filter
        if (!inTab) return false
      }
      if (!q) return true
      return (
        r.agent.name.toLowerCase().includes(q) ||
        r.agent.type.toLowerCase().includes(q) ||
        r.providerLabel.toLowerCase().includes(q) ||
        (r.model || "").toLowerCase().includes(q) ||
        (r.workspace || "").toLowerCase().includes(q)
      )
    })
    const STATUS_ORDER: AgentStatus[] = [
      "error",
      "starting",
      "running",
      "idle",
      "offline",
      "notConnected",
    ]
    out.sort((a, b) => {
      if (sort === "name") return a.agent.name.localeCompare(b.agent.name)
      if (sort === "status") {
        const d =
          STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
        if (d !== 0) return d
      }
      if (sort === "recent") {
        // Agents that have never posted sort last rather than tying at 0.
        const aTs = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : -1
        const bTs = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : -1
        if (aTs !== bTs) return bTs - aTs
      }
      return a.agent.name.localeCompare(b.agent.name)
    })
    return out
  }, [allRows, search, filter, sort])

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  // Deleting or filtering can strand the user past the end of the list.
  const current = Math.min(page, pageCount)
  useEffect(() => {
    if (page !== current) setPage(current)
  }, [page, current])

  const pageRows = useMemo(
    () => rows.slice((current - 1) * pageSize, current * pageSize),
    [rows, current, pageSize],
  )

  return {
    rows,
    pageRows,
    counts,
    page: current,
    pageCount,
    setPage,
    pageSize,
    setPageSize,
  }
}
