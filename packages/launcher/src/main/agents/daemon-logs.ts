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

/** Bytes read per step when walking back from the end of the file. */
const TAIL_CHUNK = 64 * 1024
/**
 * How far back an initial read may walk looking for lines that match the agent
 * filter. Bounds the main-process time on a large log with few matches.
 */
const MAX_SCAN_BYTES = 16 * 1024 * 1024
/** The most an incremental read takes in one go; older backlog is skipped. */
const MAX_INCREMENT_BYTES = 4 * 1024 * 1024

export interface LogTail {
  lines: string[]
  /** Byte offset to pass back on the next call. */
  size: number
  /** The file shrank (cleared or replaced): `lines` replace what was shown. */
  reset: boolean
}

function readRange(fd: number, start: number, end: number): Buffer {
  const buf = Buffer.alloc(end - start)
  let read = 0
  while (read < buf.length) {
    const n = fs.readSync(fd, buf, read, buf.length - read, start + read)
    if (n === 0) break
    read += n
  }
  return read === buf.length ? buf : buf.subarray(0, read)
}

function splitLines(buf: Buffer): string[] {
  return buf
    .toString("utf-8")
    .split("\n")
    .filter((line) => line)
}

/**
 * A line that starts a log entry. Anything else — a stack frame, wrapped
 * output — continues the entry above it, the same rule the Logs page parser
 * uses to fold lines together.
 */
const ENTRY_HEAD_RE =
  /^\[?(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2})/

function isEntryHead(line: string): boolean {
  return ENTRY_HEAD_RE.test(line)
}

/**
 * Which lines an agent filter keeps. The filter matches an entry's first line
 * and its continuation lines go with it — matched on their own, every stack
 * frame that does not happen to name the agent was dropped.
 */
interface Filtered {
  kept: string[]
  /** Continuation lines before the first entry head: their entry starts earlier. */
  leading: string[]
  /** Whether the last entry was kept; null when the lines held no entry head. */
  lastKept: boolean | null
}

function filterEntries(
  lines: string[],
  matches: (head: string) => boolean,
  keptBefore: boolean | null,
): Filtered {
  const kept: string[] = []
  const leading: string[] = []
  let state = keptBefore
  for (const line of lines) {
    if (isEntryHead(line)) state = matches(line)
    else if (state === null) {
      leading.push(line)
      continue
    }
    if (state) kept.push(line)
  }
  return { kept, leading, lastKept: state }
}

/**
 * Whether the entry running at byte `pos` was kept: looks back a bounded
 * distance for its head line. An entry whose head is further back is dropped.
 */
function entryKeptBefore(
  fd: number,
  pos: number,
  matches: (head: string) => boolean,
): boolean {
  const lines = splitLines(readRange(fd, Math.max(0, pos - TAIL_CHUNK), pos))
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isEntryHead(lines[i])) return matches(lines[i])
  }
  return false
}

/**
 * The last `count` matching lines, read backwards in chunks so the cost tracks
 * what is returned rather than the size of the file. Stops at the last newline:
 * a line still being written is left for the next incremental read.
 */
function readLastLines(
  fd: number,
  size: number,
  count: number,
  matches: ((head: string) => boolean) | null,
): { lines: string[]; end: number } {
  const lastChunk = readRange(fd, Math.max(0, size - TAIL_CHUNK), size)
  const lastNewline = lastChunk.lastIndexOf(0x0a)
  const end =
    lastNewline >= 0 ? size - lastChunk.length + lastNewline + 1 : size

  let lines: string[] = []
  let pos = end
  let carry = Buffer.alloc(0)
  // Blocks are read back to front, so continuation lines at the top of a block
  // wait here until the block before it says whether their entry was kept.
  let pending: string[] = []
  while (pos > 0 && lines.length < count && end - pos < MAX_SCAN_BYTES) {
    const start = Math.max(0, pos - TAIL_CHUNK)
    const block = Buffer.concat([readRange(fd, start, pos), carry])
    pos = start
    let body = block
    if (pos > 0) {
      // The block starts mid-line; that fragment joins the next block.
      const firstNewline = block.indexOf(0x0a)
      if (firstNewline < 0) {
        carry = block
        continue
      }
      carry = block.subarray(0, firstNewline)
      body = block.subarray(firstNewline + 1)
    } else {
      carry = Buffer.alloc(0)
    }
    if (!matches) {
      lines = [...splitLines(body), ...lines]
      continue
    }
    const { kept, leading, lastKept } = filterEntries(splitLines(body), matches, null)
    if (lastKept === null) {
      pending = [...leading, ...pending]
      continue
    }
    lines = [...kept, ...(lastKept ? pending : []), ...lines]
    pending = leading
  }
  // Anything still pending belongs to an entry this read never reached.
  return { lines: lines.slice(-count), end }
}

/**
 * Tail daemon.log for the Logs page. `offset` 0 reads the last `count` lines;
 * a non-zero `offset` (the `size` a previous call returned) reads only what
 * was appended since. Both read a bounded slice of the file — this runs on the
 * main process, and reading the whole log there froze the app on every poll.
 */
export function tailLogs(
  logFile: string,
  { agent, count, offset }: { agent?: string; count: number; offset: number },
): LogTail {
  const matches = agent
    ? (line: string) =>
        line.includes(agent) || line.includes("daemon") || line.includes("Daemon")
    : null

  let size: number
  try {
    size = fs.statSync(logFile).size
  } catch {
    return { lines: [], size: 0, reset: offset > 0 }
  }

  // Nothing appended since the last read.
  if (offset > 0 && offset === size) return { lines: [], size, reset: false }

  const fd = fs.openSync(logFile, "r")
  try {
    if (offset > 0 && offset < size) {
      const start = Math.max(offset, size - MAX_INCREMENT_BYTES)
      const buf = readRange(fd, start, size)
      const lastNewline = buf.lastIndexOf(0x0a)
      if (lastNewline < 0) {
        return { lines: [], size: start > offset ? size : offset, reset: false }
      }
      let body = buf.subarray(0, lastNewline + 1)
      // Skipped part of the backlog: drop the fragment the read landed in.
      if (start > offset) body = body.subarray(body.indexOf(0x0a) + 1)
      let lines = splitLines(body)
      if (matches) {
        // The read may start inside an entry whose head is behind `start`.
        const before =
          lines.length > 0 && !isEntryHead(lines[0])
            ? entryKeptBefore(fd, start, matches)
            : null
        lines = filterEntries(lines, matches, before).kept
      }
      return { lines, size: start + lastNewline + 1, reset: false }
    }

    // First read, or the file shrank under us (cleared, replaced).
    const { lines, end } = readLastLines(fd, size, count, matches)
    return { lines, size: end, reset: offset > 0 }
  } finally {
    fs.closeSync(fd)
  }
}
