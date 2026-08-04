import { useCallback, useMemo, useState } from "react"

import type { TimeSpan } from "@renderer/services/logs/log-metrics"
import type { LogEventType, LogLevel } from "@renderer/services/logs/log-parser"
import type { Density } from "./components/log-table"
import { LEVEL_ORDER, type LogFilters, type RangeKey } from "./use-log-view"

export type LogsView = "list" | "timeline"

export interface LogFiltersState extends LogFilters {
  density: Density
  live: boolean
  view: LogsView
}

const INITIAL: LogFiltersState = {
  agent: "",
  search: "",
  levels: new Set(LEVEL_ORDER),
  range: "30m",
  eventTypes: new Set<LogEventType>(),
  onlyWithStack: false,
  brush: null,
  sort: "desc",
  page: 1,
  pageSize: 50,
  density: "normal",
  live: true,
  view: "list",
}

export interface LogFiltersApi {
  filters: LogFiltersState
  /** Any filter change rewinds to the first page — page 12 of a new result set is meaningless. */
  update: (patch: Partial<LogFiltersState>) => void
  setPage: (page: number) => void
  setLevels: (levels: Set<LogLevel>) => void
  setBrush: (brush: TimeSpan | null) => void
  /** Level shortcut used by the stat cards. */
  focusLevel: (level: "all" | "error" | "warn") => void
  toggleSort: () => void
  activeFilterCount: number
  reset: () => void
}

export function useLogFilters(): LogFiltersApi {
  const [filters, setFilters] = useState<LogFiltersState>(INITIAL)

  const update = useCallback((patch: Partial<LogFiltersState>) => {
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }))
  }, [])

  const setPage = useCallback((page: number) => {
    setFilters((prev) => ({ ...prev, page }))
  }, [])

  const setLevels = useCallback(
    (levels: Set<LogLevel>) => update({ levels }),
    [update],
  )

  const setBrush = useCallback(
    (brush: TimeSpan | null) => update({ brush }),
    [update],
  )

  const focusLevel = useCallback(
    (level: "all" | "error" | "warn") =>
      update({ levels: level === "all" ? new Set(LEVEL_ORDER) : new Set([level]) }),
    [update],
  )

  const toggleSort = useCallback(() => {
    setFilters((prev) => ({ ...prev, sort: prev.sort === "desc" ? "asc" : "desc" }))
  }, [])

  const reset = useCallback(() => setFilters(INITIAL), [])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.agent) count += 1
    if (filters.search.trim()) count += 1
    if (filters.levels.size !== LEVEL_ORDER.length) count += 1
    if (filters.eventTypes.size > 0) count += 1
    if (filters.onlyWithStack) count += 1
    if (filters.brush) count += 1
    return count
  }, [filters])

  return {
    filters,
    update,
    setPage,
    setLevels,
    setBrush,
    focusLevel,
    toggleSort,
    activeFilterCount,
    reset,
  }
}

export type { RangeKey }
