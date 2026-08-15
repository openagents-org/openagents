import type { LogLevel, ParsedLog } from './log-parser'

export interface TimeBucket {
  start: number
  end: number
  error: number
  warn: number
  info: number
  total: number
  /** Distinct agents that emitted into this bucket. */
  agents: string[]
}

export interface TimeSpan {
  start: number
  end: number
}

export interface Incident extends TimeSpan {
  agents: number
  events: number
}

export interface AgentLane {
  agent: string
  entries: ParsedLog[]
  total: number
  errors: number
}

/** Widest span the entries cover, falling back to a window ending now. */
export function spanOf(entries: ParsedLog[], fallbackMs: number, now: number): TimeSpan {
  const times = entries.map((e) => e.time).filter((t): t is number => t !== null)
  if (times.length === 0) return { start: now - fallbackMs, end: now }
  const start = Math.min(...times)
  const end = Math.max(...times)
  // A single instant has no width to draw; give it a minute of breathing room.
  return end - start < 60_000 ? { start, end: start + 60_000 } : { start, end }
}

export function bucketize(
  entries: ParsedLog[],
  span: TimeSpan,
  count: number,
): TimeBucket[] {
  const width = Math.max(1, (span.end - span.start) / count)
  const seen: Array<Set<string>> = []
  const buckets: TimeBucket[] = Array.from({ length: count }, (_, i) => {
    seen.push(new Set())
    return {
      start: span.start + i * width,
      end: span.start + (i + 1) * width,
      error: 0,
      warn: 0,
      info: 0,
      total: 0,
      agents: [],
    }
  })

  for (const e of entries) {
    if (e.time === null) continue
    const idx = Math.min(count - 1, Math.max(0, Math.floor((e.time - span.start) / width)))
    const b = buckets[idx]
    if (e.level === 'error') b.error += 1
    else if (e.level === 'warn') b.warn += 1
    else b.info += 1
    b.total += 1
    if (e.agent) seen[idx].add(e.agent)
  }

  buckets.forEach((b, i) => {
    b.agents = Array.from(seen[i])
  })
  return buckets
}

/** Series for the stat-card sparklines — one value per bucket. */
export function seriesOf(
  buckets: TimeBucket[],
  pick: (b: TimeBucket) => number,
): number[] {
  return buckets.map(pick)
}

export function countByLevel(entries: ParsedLog[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = {
    error: 0,
    warn: 0,
    info: 0,
    debug: 0,
    trace: 0,
    unknown: 0,
  }
  for (const e of entries) counts[e.level] += 1
  return counts
}

/**
 * Windows where errors land across two or more agents at once — the sign of a
 * shared cause (endpoint down, network drop) rather than one agent misbehaving.
 * Adjacent qualifying buckets merge into a single incident.
 */
export function findIncidents(buckets: TimeBucket[], minAgents = 2): Incident[] {
  const out: Incident[] = []
  let current: Incident | null = null

  for (const b of buckets) {
    const errorAgents = b.error > 0 ? b.agents.length : 0
    if (b.error > 0 && errorAgents >= minAgents) {
      if (current) {
        current.end = b.end
        current.events += b.error + b.warn
        current.agents = Math.max(current.agents, errorAgents)
      } else {
        current = {
          start: b.start,
          end: b.end,
          agents: errorAgents,
          events: b.error + b.warn,
        }
      }
    } else if (current) {
      out.push(current)
      current = null
    }
  }
  if (current) out.push(current)
  return out
}

/** One lane per agent, busiest first; unattributed lines land in `null`. */
export function lanesOf(entries: ParsedLog[], unknownLabel: string): AgentLane[] {
  const map = new Map<string, ParsedLog[]>()
  for (const e of entries) {
    const key = e.agent || unknownLabel
    const list = map.get(key)
    if (list) list.push(e)
    else map.set(key, [e])
  }
  return Array.from(map.entries())
    .map(([agent, list]) => ({
      agent,
      entries: list,
      total: list.length,
      errors: list.filter((e) => e.level === 'error').length,
    }))
    .sort((a, b) => b.total - a.total)
}

export function formatDuration(ms: number | null): string | null {
  if (ms === null) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** `15:55:40.123` — the log's own clock, not a locale-formatted date. */
export function formatClock(time: number | null, withMillis = false): string {
  if (time === null) return '—'
  const d = new Date(time)
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return withMillis ? `${base}.${pad(d.getMilliseconds(), 3)}` : base
}

export function formatDateTime(time: number | null): string {
  if (time === null) return '—'
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatClock(time, true)}`
}
