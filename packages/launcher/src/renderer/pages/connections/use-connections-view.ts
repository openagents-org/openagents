import { useMemo, useState } from "react"

import { PLATFORMS, type PlatformDef } from "@renderer/components/connections/platforms"
import type { ConnectionRecord } from "@renderer/types"

import type { ConnectionFilter } from "./empty-state"

export type ConnectionSort = "platform" | "status" | "lastSync"
export const CONNECTION_SORTS: ConnectionSort[] = ["platform", "status", "lastSync"]

export interface ConnectionRow {
  platform: PlatformDef
  connection: ConnectionRecord | null
  connected: boolean
  /** Integration isn't finished — the row is read-only. */
  planned: boolean
}

export interface ConnectionStats {
  connected: number
  /** Connectable today, but not connected yet. */
  pending: number
  planned: number
  /** Most recent successful sync across every connection. */
  lastSyncAt: string | null
}

export interface ConnectionsView {
  rows: ConnectionRow[]
  stats: ConnectionStats
  byPlatform: Map<string, ConnectionRecord>
  search: string
  setSearch: (v: string) => void
  filter: ConnectionFilter
  setFilter: (v: ConnectionFilter) => void
  sort: ConnectionSort
  setSort: (v: ConnectionSort) => void
  ascending: boolean
  toggleDirection: () => void
}

/** Connected first, then things that need attention, then the rest. */
const STATUS_RANK: Record<string, number> = {
  connected: 0,
  expired: 1,
  unauthorized: 1,
  rate_limited: 1,
  error: 1,
  offline: 2,
  disconnected: 3,
}

export function useConnectionsView(
  connections: ConnectionRecord[],
): ConnectionsView {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<ConnectionFilter>("all")
  const [sort, setSort] = useState<ConnectionSort>("platform")
  const [ascending, setAscending] = useState(true)

  const byPlatform = useMemo(() => {
    const m = new Map<string, ConnectionRecord>()
    for (const c of connections) m.set(c.platform, c)
    return m
  }, [connections])

  const all = useMemo<ConnectionRow[]>(
    () =>
      PLATFORMS.map((platform) => {
        const connection = byPlatform.get(platform.id) || null
        return {
          platform,
          connection,
          connected: connection?.status === "connected",
          planned: platform.support === "planned",
        }
      }),
    [byPlatform],
  )

  const stats = useMemo<ConnectionStats>(() => {
    let connected = 0
    let planned = 0
    let pending = 0
    let lastSyncAt: string | null = null
    for (const row of all) {
      if (row.connected) connected += 1
      else if (row.planned) planned += 1
      else pending += 1
      const at = row.connection?.lastSyncAt
      if (at && (!lastSyncAt || at > lastSyncAt)) lastSyncAt = at
    }
    return { connected, pending, planned, lastSyncAt }
  }, [all])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = all.filter((row) => {
      if (
        q &&
        !row.platform.label.toLowerCase().includes(q) &&
        !row.platform.id.includes(q)
      )
        return false
      if (filter === "connected") return row.connected
      if (filter === "disconnected") return !row.connected
      return true
    })

    const direction = ascending ? 1 : -1
    return filtered.sort((a, b) => {
      if (sort === "status") {
        const rank =
          (STATUS_RANK[a.connection?.status || "disconnected"] ?? 9) -
          (STATUS_RANK[b.connection?.status || "disconnected"] ?? 9)
        if (rank) return rank * direction
      }
      if (sort === "lastSync") {
        // Never-synced sorts last in both directions: it is the absence of a
        // value, not the oldest one.
        const av = a.connection?.lastSyncAt
        const bv = b.connection?.lastSyncAt
        if (av !== bv) {
          if (!av) return 1
          if (!bv) return -1
          return av < bv ? direction : -direction
        }
      }
      return a.platform.label.localeCompare(b.platform.label) * direction
    })
  }, [all, search, filter, sort, ascending])

  return {
    rows,
    stats,
    byPlatform,
    search,
    setSearch,
    filter,
    setFilter,
    sort,
    setSort,
    ascending,
    toggleDirection: () => setAscending((v) => !v),
  }
}
