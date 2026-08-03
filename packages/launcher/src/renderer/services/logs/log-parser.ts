export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'unknown'

/** Coarse bucket used by the "event type" column and the extra filters. */
export type LogEventType =
  | 'poll'
  | 'heartbeat'
  | 'message'
  | 'network'
  | 'lifecycle'
  | 'auth'
  | 'log'

export interface LogTag {
  /** i18n key suffix under `logs.tag.*`, or `raw` to print the key verbatim. */
  key: string
  value: string
}

export interface ParsedLog {
  /** Index of the entry's first line in the buffer — stable list key. */
  id: number
  /** Full original text, continuation lines included. */
  raw: string
  timestamp: string | null
  /** Epoch ms, when the timestamp parsed. */
  time: number | null
  /** Level after severity inference — what the UI filters and colours on. */
  level: LogLevel
  /** Level literally written in the file, before inference. */
  rawLevel: LogLevel
  /** Agent the line belongs to, from the `[name]` segment. */
  agent: string | null
  /** Emitting component: daemon, adapter, launcher… */
  scope: string | null
  message: string
  eventType: LogEventType
  /** Milliseconds, when the message states a duration. */
  durationMs: number | null
  /** Continuation lines (stack traces and other wrapped output). */
  stack: string[]
  tags: LogTag[]
  json: unknown | null
}

const HEAD_RE =
  /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?\s*/
const SHORT_TIME_RE = /^\[?(\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\]?\s+/
const LEVEL_TOKEN_RE =
  /^(INFO|WARN|WARNING|ERROR|ERR|DEBUG|DBG|TRACE|TRC|FATAL|CRIT|CRITICAL)\b[\s:-]*/i
/** `adapter [cursor-cc]:` / `daemon:` / `launcher:` */
const SCOPE_RE = /^([a-zA-Z][\w.-]{0,30})\s*(?:\[([^\]]{1,60})\])?\s*:\s*/
/** `daemon: cursor-cc adapter stopped` — the agent hides inside the message. */
const DAEMON_AGENT_RE = /^([\w-]{2,40})\s+adapter\s+(?:started|stopped|restarted)/i

// Severity inference. The daemon writes nearly everything at INFO, so a page
// that trusted the level token alone would report zero errors while the log is
// full of failed polls. Warn wins over error when the message says the failure
// is being retried — a heartbeat that will try again is not an outage.
const WARN_RE =
  /\b(warn(?:ing)?|retry|retrying|consecutive failures|deprecated|degraded|skipped|slow)\b/i
const ERROR_RE =
  /\b(failed|failure|error|exception|crashed?|refused|denied|timed ?out|timeout|unauthorized|forbidden|econnreset|econnrefused|etimedout|enotfound|epipe|fatal|exited early|invalid)\b/i

const DURATION_RE =
  /\b(?:in|took|after|elapsed|latency|duration)[=:\s]\s*(\d+(?:\.\d+)?)\s*(ms|s)\b/i
const BARE_MS_RE = /\((\d+(?:\.\d+)?)\s?ms\)/i

const EVENT_RULES: Array<[RegExp, LogEventType]> = [
  [/\bpoll\b|\bpolling\b/i, 'poll'],
  [/heartbeat/i, 'heartbeat'],
  [/\bmessages?\b|\breply\b|\bsent\b/i, 'message'],
  [/socket|tls|network|econn|request to|http/i, 'network'],
  [/daemon|adapter (?:started|stopped)|shutting down|exited|spawn/i, 'lifecycle'],
  [/auth|token|credential|login|api key/i, 'auth'],
]

const TAG_RULES: Array<[RegExp, string]> = [
  [/\brequest[_-]?id[=:\s]+([\w-]{4,40})/i, 'requestId'],
  [/\bcursor=([\w-]{4,40})/i, 'cursor'],
  [/consecutive failures:?\s*(\d+)/i, 'consecutiveFailures'],
  [/\bPoll #(\d+)/i, 'poll'],
  [/\bcode=(\S+)/i, 'code'],
  [/\bsignal=(\S+)/i, 'signal'],
  [/\bpid[=:\s]+(\d+)/i, 'pid'],
  [/\bstate:\s*([\w-]+)/i, 'state'],
]

function levelFrom(token: string | undefined): LogLevel {
  if (!token) return 'unknown'
  const t = token.toUpperCase()
  if (t === 'WARNING') return 'warn'
  if (t === 'ERR') return 'error'
  if (t === 'DBG') return 'debug'
  if (t === 'TRC') return 'trace'
  if (['FATAL', 'CRIT', 'CRITICAL'].includes(t)) return 'error'
  return t.toLowerCase() as LogLevel
}

/** Only ever escalates: a line written as DEBUG stays DEBUG. */
function inferLevel(rawLevel: LogLevel, text: string, hasStack: boolean): LogLevel {
  if (rawLevel === 'error' || rawLevel === 'warn') return rawLevel
  if (rawLevel === 'debug' || rawLevel === 'trace') return rawLevel
  if (WARN_RE.test(text)) return 'warn'
  if (hasStack || ERROR_RE.test(text)) return 'error'
  return rawLevel
}

function eventTypeFrom(text: string): LogEventType {
  for (const [re, type] of EVENT_RULES) if (re.test(text)) return type
  return 'log'
}

function durationFrom(text: string): number | null {
  const m = text.match(DURATION_RE) || text.match(BARE_MS_RE)
  if (!m) return null
  const value = Number(m[1])
  if (!Number.isFinite(value)) return null
  return m[2]?.toLowerCase() === 's' ? value * 1000 : value
}

function tagsFrom(text: string): LogTag[] {
  const out: LogTag[] = []
  for (const [re, key] of TAG_RULES) {
    const m = text.match(re)
    if (m) out.push({ key, value: m[1] })
  }
  return out
}

/**
 * Try to extract trailing JSON `{...}` or `[...]` if it parses cleanly.
 * Cheap heuristic; we don't try to repair invalid JSON.
 */
function extractJSON(text: string): { json: unknown | null; rest: string } {
  const trimmed = text.trim()
  if (!trimmed) return { json: null, rest: text }
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '{' && last === '}') || (first === '[' && last === ']')) {
    try {
      return { json: JSON.parse(trimmed), rest: '' }
    } catch {
      // not valid — fall through
    }
  }
  const lastOpen = text.lastIndexOf('{')
  if (lastOpen > 0 && trimmed.endsWith('}')) {
    try {
      return { json: JSON.parse(text.slice(lastOpen).trim()), rest: text.slice(0, lastOpen).trim() }
    } catch {
      // not valid — fall through
    }
  }
  return { json: null, rest: text }
}

/** A line that does not start with a timestamp continues the previous entry. */
function isContinuation(line: string): boolean {
  if (!line.trim()) return false
  return !HEAD_RE.test(line) && !SHORT_TIME_RE.test(line)
}

export function parseLine(raw: string, id = 0, stack: string[] = []): ParsedLog {
  const out: ParsedLog = {
    id,
    raw: [raw, ...stack].join('\n'),
    timestamp: null,
    time: null,
    level: 'unknown',
    rawLevel: 'unknown',
    agent: null,
    scope: null,
    message: raw,
    eventType: 'log',
    durationMs: null,
    stack,
    tags: [],
    json: null,
  }
  if (!raw.trim()) return out

  let working = raw
  const head = working.match(HEAD_RE) || working.match(SHORT_TIME_RE)
  if (head) {
    out.timestamp = head[1]
    const parsed = Date.parse(head[1])
    if (!Number.isNaN(parsed)) out.time = parsed
    working = working.slice(head[0].length)
  }

  const levelMatch = working.match(LEVEL_TOKEN_RE)
  if (levelMatch) {
    out.rawLevel = levelFrom(levelMatch[1])
    working = working.slice(levelMatch[0].length)
  }

  // Only after a timestamp: a tail that starts mid-stack would otherwise read
  // "Stack: Error: …" as a scope named `Stack`.
  const scopeMatch = head ? working.match(SCOPE_RE) : null
  if (scopeMatch) {
    out.scope = scopeMatch[1]
    out.agent = scopeMatch[2] || null
    working = working.slice(scopeMatch[0].length)
  }

  const { json, rest } = extractJSON(working.trim())
  out.json = json
  out.message = (json !== null ? rest : working).trim() || raw.trim()

  if (!out.agent) {
    const named = out.message.match(DAEMON_AGENT_RE)
    if (named) out.agent = named[1]
  }

  const searchable = [out.message, ...stack].join('\n')
  out.level = inferLevel(out.rawLevel, out.message, stack.length > 0)
  out.eventType = eventTypeFrom(out.message)
  out.durationMs = durationFrom(out.message)
  out.tags = tagsFrom(searchable)
  return out
}

/** Folds continuation lines (stack traces) into the entry that owns them. */
export function parseLines(lines: string[]): ParsedLog[] {
  const out: ParsedLog[] = []
  let headIndex = -1
  let headLine = ''
  let stack: string[] = []

  const flush = (): void => {
    if (headIndex < 0) return
    if (headLine.trim()) out.push(parseLine(headLine, headIndex, stack))
    headIndex = -1
    stack = []
  }

  lines.forEach((line, i) => {
    if (headIndex >= 0 && isContinuation(line)) {
      stack.push(line)
      return
    }
    flush()
    headIndex = i
    headLine = line
  })
  flush()
  return out
}
