import { useMemo } from "react"

import {
  bucketize,
  countByLevel,
  findIncidents,
  lanesOf,
  spanOf,
  type AgentLane,
  type Incident,
  type TimeBucket,
  type TimeSpan,
} from "@renderer/services/logs/log-metrics"
import type {
  LogEventType,
  LogLevel,
  ParsedLog,
} from "@renderer/services/logs/log-parser"

export const RANGES = ["15m", "30m", "1h", "6h", "24h", "all"] as const
export type RangeKey = (typeof RANGES)[number]

const RANGE_MS: Record<RangeKey, number> = {
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  all: Number.POSITIVE_INFINITY,
}

/** Buckets behind the sparklines and the density chart. */
const SPARK_BUCKETS = 32
const DENSITY_BUCKETS = 60

export const LEVEL_ORDER: LogLevel[] = ["error", "warn", "info", "debug"]

export interface LogFilters {
  agent: string
  search: string
  levels: Set<LogLevel>
  range: RangeKey
  eventTypes: Set<LogEventType>
  onlyWithStack: boolean
  /** Time window brushed on the density chart, if any. */
  brush: TimeSpan | null
  sort: "asc" | "desc"
  page: number
  pageSize: number
}

export interface LogView {
  /** Everything but the level filter — keeps the stat cards stable. */
  scoped: ParsedLog[]
  /** Level filter applied; feeds the density chart. */
  levelled: ParsedLog[]
  /** Brush applied; what the table and lanes render. */
  filtered: ParsedLog[]
  /** `filtered` in display order — the page slice comes off this. */
  ordered: ParsedLog[]
  pageItems: ParsedLog[]
  pageCount: number
  levelCounts: Record<LogLevel, number>
  activeAgents: number
  span: TimeSpan
  sparkBuckets: TimeBucket[]
  densityBuckets: TimeBucket[]
  incidents: Incident[]
  lanes: AgentLane[]
}

function matchesSearch(e: ParsedLog, q: string): boolean {
  if (!q) return true
  return (
    e.message.toLowerCase().includes(q) ||
    (e.agent || "").toLowerCase().includes(q) ||
    (e.scope || "").toLowerCase().includes(q) ||
    e.tags.some((tag) => tag.value.toLowerCase().includes(q)) ||
    e.raw.toLowerCase().includes(q)
  )
}

/**
 * Derives everything the page draws from one pass of filters, so the table,
 * the cards and the timeline can never disagree about what is on screen.
 *
 * `now` is passed in rather than read here — it advances with the feed instead
 * of on every render, which keeps the memos from recomputing continuously.
 */
export function useLogView(
  entries: ParsedLog[],
  filters: LogFilters,
  now: number,
  unknownAgentLabel: string,
): LogView {
  const {
    agent,
    search,
    levels,
    range,
    eventTypes,
    onlyWithStack,
    brush,
    sort,
    page,
    pageSize,
  } = filters

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const windowMs = RANGE_MS[range]
    const floor = Number.isFinite(windowMs) ? now - windowMs : null
    return entries.filter((e) => {
      if (floor !== null && e.time !== null && e.time < floor) return false
      if (agent && e.agent !== agent) return false
      if (eventTypes.size > 0 && !eventTypes.has(e.eventType)) return false
      if (onlyWithStack && e.stack.length === 0) return false
      return matchesSearch(e, q)
    })
  }, [entries, agent, search, range, eventTypes, onlyWithStack, now])

  const levelled = useMemo(
    () => scoped.filter((e) => levels.has(e.level)),
    [scoped, levels],
  )

  const filtered = useMemo(() => {
    if (!brush) return levelled
    return levelled.filter(
      (e) => e.time !== null && e.time >= brush.start && e.time <= brush.end,
    )
  }, [levelled, brush])

  const span = useMemo(
    () => spanOf(scoped, Number.isFinite(RANGE_MS[range]) ? RANGE_MS[range] : 60 * 60_000, now),
    [scoped, range, now],
  )

  const sparkBuckets = useMemo(
    () => bucketize(scoped, span, SPARK_BUCKETS),
    [scoped, span],
  )
  const densityBuckets = useMemo(
    () => bucketize(levelled, span, DENSITY_BUCKETS),
    [levelled, span],
  )
  const incidents = useMemo(() => findIncidents(densityBuckets), [densityBuckets])

  const levelCounts = useMemo(() => countByLevel(scoped), [scoped])
  const activeAgents = useMemo(
    () => new Set(scoped.map((e) => e.agent).filter(Boolean)).size,
    [scoped],
  )

  const lanes = useMemo(
    () => lanesOf(filtered, unknownAgentLabel),
    [filtered, unknownAgentLabel],
  )

  const ordered = useMemo(() => {
    const list = [...filtered]
    // Fall back to buffer order for lines the parser found no timestamp on.
    list.sort((a, b) => {
      const at = a.time ?? a.id
      const bt = b.time ?? b.id
      return sort === "asc" ? at - bt : bt - at
    })
    return list
  }, [filtered, sort])

  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pageItems = useMemo(
    () => ordered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [ordered, safePage, pageSize],
  )

  return {
    scoped,
    levelled,
    filtered,
    ordered,
    pageItems,
    pageCount,
    levelCounts,
    activeAgents,
    span,
    sparkBuckets,
    densityBuckets,
    incidents,
    lanes,
  }
}
