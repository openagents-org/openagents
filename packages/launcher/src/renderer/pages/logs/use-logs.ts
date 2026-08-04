import { useCallback, useEffect, useRef, useState } from "react"

import { parseLines, type ParsedLog } from "@renderer/services/logs/log-parser"

/** Enough history to fill the 24h range without re-reading the whole file. */
const INITIAL_LINES = 2000
/** Ring-buffer cap; older lines are dropped rather than growing without bound. */
const MAX_BUFFER = 6000
const POLL_MS = 3000

export interface LogsFeed {
  lines: string[]
  entries: ParsedLog[]
  loading: boolean
  /** Epoch ms of the last successful read — drives the "updated" caption. */
  lastUpdated: number | null
  error: string | null
  refresh: (reset?: boolean) => Promise<void>
}

interface Options {
  agentFilter: string
  autoRefresh: boolean
}

/**
 * Tails the agent log file, reading incrementally from a byte offset. Parsing
 * happens here so every consumer sees the same folded (stack-aware) entries.
 */
export function useLogs({ agentFilter, autoRefresh }: Options): LogsFeed {
  const [lines, setLines] = useState<string[]>([])
  const [entries, setEntries] = useState<ParsedLog[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const offset = useRef(0)
  /** Mirrors `lines` so incremental reads never depend on a stale closure. */
  const linesRef = useRef<string[]>([])
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

      if (shouldReset || result.lines?.length) {
        const next = shouldReset
          ? (result.lines ?? [])
          : [...linesRef.current, ...(result.lines ?? [])].slice(-MAX_BUFFER)
        linesRef.current = next
        setLines(next)
        setEntries(parseLines(next))
      }
      setError(null)
      setLastUpdated(Date.now())
    } catch (err: unknown) {
      if (mounted.current) setError((err as Error).message)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  // Re-read from the top whenever the agent filter changes.
  useEffect(() => {
    offset.current = 0
    setLoading(true)
    void refresh(true)
  }, [refresh, agentFilter])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => void refresh(false), POLL_MS)
    return () => clearInterval(id)
  }, [autoRefresh, refresh])

  return { lines, entries, loading, lastUpdated, error, refresh }
}
