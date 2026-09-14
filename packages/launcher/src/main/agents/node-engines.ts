/**
 * Does a Node version satisfy a package's `engines.node` range?
 *
 * Every npm agent is installed and run on one Node — the portable runtime in
 * ~/.openagents/nodejs (see resolveNpmInvocation). npm only warns when a
 * package's engines field rules that Node out, so nothing stopped the launcher
 * asking for a release its own Node cannot run, until a package refused on its
 * own: openclaw 2026.9.3 added a preinstall script that exits non-zero below
 * Node 24.16, and every update on the bundled Node 22 failed.
 *
 * Covers the grammar packages actually write in `engines.node`: comparators
 * (>= > <= < =), bare and partial versions (22, 22.1, 22.x, *), caret, tilde,
 * hyphen ranges and `||`. Anything else — a pre-release tag, build metadata, a
 * word where a version belongs — answers null, "can't tell", which callers
 * treat as compatible: a wrong "no" would hold an agent back for nothing, so
 * the answer is only ever no when it is certain.
 */

type Triple = [number, number, number]

/** `lo` inclusive, `hi` exclusive; a missing end is open. */
interface Interval {
  lo?: Triple
  hi?: Triple
}

/** Up to three parts; a missing or x/* part is null, and so is all after it. */
const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/

function parsePartial(s: string): Array<number | null> | null {
  const m = PARTIAL.exec(s)
  if (!m) return null
  const parts = [m[1], m[2], m[3]].map((p) =>
    p === undefined || /^[xX*]$/.test(p) ? null : Number(p),
  )
  const wild = parts.indexOf(null)
  return wild === -1 ? parts : parts.map((p, i) => (i < wild ? p : null))
}

function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/**
 * One comparator as the interval it allows, or null when it isn't one we read.
 * Versions are whole numbers, so every operator reduces to `>=` and `<`:
 * `>1.2.3` is `>=1.2.4`, and `<=22` is `<23.0.0`.
 */
function toInterval(comparator: string): Interval | null {
  const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(comparator)
  const parts = m && parsePartial(m[2])
  if (!m || !parts) return null
  const op = m[1] || "="
  const [major, minor, patch] = parts
  // `<*` and `>*` match nothing; not worth modelling, so not read.
  if (major === null) return op === "<" || op === ">" ? null : {}
  const lo: Triple = [major, minor ?? 0, patch ?? 0]
  // The first version past what was written: 22 → 23.0.0, 22.1 → 22.2.0.
  const next: Triple =
    minor === null
      ? [major + 1, 0, 0]
      : patch === null
        ? [major, minor + 1, 0]
        : [major, minor, patch + 1]
  switch (op) {
    case ">=":
      return { lo }
    case ">":
      return { lo: next }
    case "<":
      return { hi: lo }
    case "<=":
      return { hi: next }
    case "~":
      return {
        lo,
        hi: minor === null ? [major + 1, 0, 0] : [major, minor + 1, 0],
      }
    case "^":
      return {
        lo,
        hi:
          major > 0 || minor === null
            ? [major + 1, 0, 0]
            : minor > 0 || patch === null
              ? [0, minor + 1, 0]
              : [0, 0, patch + 1],
      }
    default:
      return { lo, hi: next }
  }
}

/** A `||`-free range as its intervals, or null when any part isn't readable. */
function parseSet(set: string): Interval[] | null {
  const s = set.trim()
  // `18 - 22`: a hyphen range, inclusive at both ends.
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(s)
  const comparators = hyphen
    ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`]
    : s
        .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
        .split(/\s+/)
        .filter(Boolean)
  const out: Interval[] = []
  for (const c of comparators) {
    const interval = toInterval(c)
    if (!interval) return null
    out.push(interval)
  }
  return out
}

/**
 * True or false when the range can be read, null when it can't. One readable
 * alternative that fits is enough for true, whatever the others say.
 */
export function nodeSatisfies(version: string, range: string): boolean | null {
  const parts = parsePartial(version.trim())
  if (!parts || parts.includes(null)) return null
  const v = parts as Triple
  let unreadable = false
  for (const set of range.split("||")) {
    const intervals = parseSet(set)
    if (!intervals) {
      unreadable = true
      continue
    }
    const inside = intervals.every(
      ({ lo, hi }) =>
        (!lo || compare(v, lo) >= 0) && (!hi || compare(v, hi) < 0),
    )
    if (inside) return true
  }
  return unreadable ? null : false
}
