import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { parseLines, type LogLevel } from "@renderer/services/logs/log-parser"

const INITIAL_LINES = 400
/** Ring-buffer cap; older lines are dropped rather than growing without bound. */
const MAX_BUFFER = 2000
const POLL_MS = 3000
/** How close to the bottom still counts as "following the tail". */
const STICK_THRESHOLD_PX = 40

export const LEVEL_ORDER: LogLevel[] = [
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "unknown",
]

export interface LogsState {
  lines: string[]
  entries: ReturnType<typeof parseLines>
  filtered: Array<{ p: ReturnType<typeof parseLines>[number]; i: number }>
  levelCounts: Record<LogLevel, number>
  containerRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
  refresh: (reset?: boolean) => Promise<void>
  resetOffset: () => void
}

interface Options {
  agentFilter: string
  search: string
  enabledLevels: Set<LogLevel>
  autoRefresh: boolean
}

/**
 * Tails the agent log file. Reads incrementally from a byte offset and keeps
 * the view pinned to the bottom unless the user has scrolled up.
 */
export function useLogs({
  agentFilter,
  search,
  enabledLevels,
  autoRefresh,
}: Options): LogsState {
  const [lines, setLines] = useState<string[]>([])
  const offset = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const mounted = useRef(true)
  const filterRef = useRef(agentFilter)
  filterRef.current = agentFilter

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async (reset = false) => {
    if (!mounted.current) return
    try {
      const shouldReset = reset || offset.current === 0
      const result = await window.api.tailAgentLogs(
        filterRef.current,
        INITIAL_LINES,
        shouldReset ? 0 : offset.current,
      )
      if (!mounted.current) return
      offset.current = result.size || 0

      if (shouldReset) {
        setLines(result.lines?.length ? result.lines : [])
      } else if (result.lines?.length) {
        setLines((prev) => [...prev, ...result.lines].slice(-MAX_BUFFER))
      }

      if (stickToBottom.current) {
        setTimeout(() => {
          const el = containerRef.current
          if (el) el.scrollTop = el.scrollHeight
        }, 0)
      }
    } catch (err: unknown) {
      if (mounted.current) setLines([`Error loading logs: ${(err as Error).message}`])
    }
  }, [])

  // Re-read from the top whenever the agent filter changes.
  useEffect(() => {
    offset.current = 0
    refresh(true)
  }, [refresh, agentFilter])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => refresh(false), POLL_MS)
    return () => clearInterval(id)
  }, [autoRefresh, refresh])

  const entries = useMemo(() => parseLines(lines), [lines])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => {
        if (!enabledLevels.has(p.level)) return false
        if (!q) return true
        return (
          p.message.toLowerCase().includes(q) ||
          (p.source || "").toLowerCase().includes(q) ||
          p.raw.toLowerCase().includes(q)
        )
      })
  }, [entries, search, enabledLevels])

  const levelCounts = useMemo(() => {
    const counts = LEVEL_ORDER.reduce(
      (acc, l) => ({ ...acc, [l]: 0 }),
      {} as Record<LogLevel, number>,
    )
    for (const p of entries) counts[p.level] += 1
    return counts
  }, [entries])

  const onScroll = (): void => {
    const el = containerRef.current
    if (!el) return
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX
  }

  return {
    lines,
    entries,
    filtered,
    levelCounts,
    containerRef,
    onScroll,
    refresh,
    resetOffset: () => {
      offset.current = 0
    },
  }
}
