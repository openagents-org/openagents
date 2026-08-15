/**
 * Clearing a time range out of daemon.log.
 *
 * The log is a single append-only file shared by every agent, and most of its
 * lines carry only a wall clock (`[14:03:11]`) — no date. So deleting "between
 * 9am and noon yesterday" means walking backwards and reconstructing which day
 * each clock belongs to, which is what resolveLogHeaderTimestamps does.
 */
import fs from "fs"

export function normalizeTimeValue(value: string | number | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export function filterLogsByTimeRange(
  lines: string[],
  start: Date,
  end: Date,
): { keptLines: string[]; removed: number } {
  const headerTimes = resolveLogHeaderTimestamps(lines, end)
  let activeRemove = false
  let removed = 0
  const keptLines: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const headerTime = headerTimes[index]
    if (headerTime) {
      const time = headerTime.getTime()
      activeRemove = time >= start.getTime() && time <= end.getTime()
    }
    if (activeRemove) {
      removed++
    } else {
      keptLines.push(lines[index])
    }
  }

  return { keptLines, removed }
}

function resolveLogHeaderTimestamps(
  lines: string[],
  referenceTime: Date,
): (Date | null)[] {
  const resolved: (Date | null)[] = new Array(lines.length).fill(null)
  let currentDay = startOfLocalDay(referenceTime)
  let lastClockSeconds: number | null = null

  for (let index = lines.length - 1; index >= 0; index--) {
    const token = parseLogTimestampToken(lines[index])
    if (!token) continue

    if (token.kind === "iso") {
      resolved[index] = token.date
      currentDay = startOfLocalDay(token.date)
      lastClockSeconds =
        token.date.getHours() * 3600 +
        token.date.getMinutes() * 60 +
        token.date.getSeconds()
      continue
    }

    if (lastClockSeconds !== null && token.seconds > lastClockSeconds) {
      currentDay = addLocalDays(currentDay, -1)
    }

    resolved[index] = withLocalClock(currentDay, token.seconds)
    lastClockSeconds = token.seconds
  }

  return resolved
}

function parseLogTimestampToken(
  line: string,
): { kind: "iso"; date: Date } | { kind: "clock"; seconds: number } | null {
  if (!line) return null

  const isoMatch = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))/,
  )
  if (isoMatch) {
    const date = new Date(isoMatch[1])
    if (!Number.isNaN(date.getTime())) return { kind: "iso", date }
  }

  const clockMatch = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/)
  if (clockMatch) {
    return {
      kind: "clock",
      seconds:
        Number(clockMatch[1]) * 3600 +
        Number(clockMatch[2]) * 60 +
        Number(clockMatch[3]),
    }
  }

  return null
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function withLocalClock(day: Date, seconds: number): Date {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
    secs,
  )
}

/**
 * Delete every log line stamped inside [start, end] from `logFile`, in place.
 * Returns how many lines went and how many are left; a missing file is not an
 * error (nothing to clear).
 */
export function clearLogsInRange(
  logFile: string,
  start: string | number | Date,
  end: string | number | Date,
): { removed: number; remaining: number } {
  const startTime = normalizeTimeValue(start)
  const endTime = normalizeTimeValue(end)

  if (!startTime || !endTime) {
    throw new Error("Start time and end time are required")
  }
  if (startTime.getTime() > endTime.getTime()) {
    throw new Error("Start time must be before end time")
  }

  if (!fs.existsSync(logFile)) return { removed: 0, remaining: 0 }

  const content = fs.readFileSync(logFile, "utf-8")
  const hasTrailingNewline = content.endsWith("\n")
  const allLines = content.split("\n")
  if (hasTrailingNewline) allLines.pop()

  const { keptLines, removed } = filterLogsByTimeRange(
    allLines,
    startTime,
    endTime,
  )

  const nextContent =
    keptLines.join("\n") +
    (hasTrailingNewline && keptLines.length > 0 ? "\n" : "")

  // Rewrite in place rather than write-temp + rename. The daemon spawn
  // inherits an open append-mode handle to daemon.log
  // (`stdio: ['ignore', logFd, logFd]`), and on Windows `renameSync` over a
  // file with any open handle fails with EPERM — that's why the Clear Logs
  // dialog used to dead-end with a rename error. `openSync('a')` uses
  // shared write/read/delete mode, so a parallel `r+` open + truncate
  // succeeds while the daemon keeps appending at the new file end.
  const nextBytes = Buffer.from(nextContent, "utf-8")
  const fd = fs.openSync(logFile, "r+")
  try {
    if (nextBytes.length > 0)
      fs.writeSync(fd, nextBytes, 0, nextBytes.length, 0)
    fs.ftruncateSync(fd, nextBytes.length)
  } finally {
    fs.closeSync(fd)
  }

  return { removed, remaining: keptLines.length }
}
