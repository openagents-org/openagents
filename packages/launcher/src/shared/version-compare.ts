/**
 * Version comparison for "is an update available?" decisions.
 *
 * Every such check used to be `current !== latest`. That is wrong in one
 * direction: it also fires when the installed version is *newer* than the
 * registry's stable `latest`, which is exactly what happens after switching an
 * agent to the beta or nightly channel. The UI then offers an "update" that
 * silently downgrades, and because the downgrade makes the strings differ
 * again, the prompt never goes away.
 *
 * Semver ordering, including the rule that a pre-release sorts *below* its own
 * release (1.2.0-beta.1 < 1.2.0), is what these decisions actually need.
 */

interface ParsedVersion {
  release: number[]
  prerelease: string[]
}

/** Parse `1.2.3`, `1.2.3-beta.4`, `1.2.3+build` — returns null if not semver-ish. */
function parseVersion(raw: string): ParsedVersion | null {
  const v = raw.trim().replace(/^v/, "")
  // Build metadata is explicitly ignored for precedence by the semver spec.
  const withoutBuild = v.split("+")[0]
  const [core, ...preParts] = withoutBuild.split("-")
  const release = core.split(".")
  // Require at least `major.minor`. A single numeric segment would otherwise
  // swallow date stamps: "2026-07-21" parses as version 2026 with pre-release
  // "07.21", which is not a version at all and must fall back to inequality.
  if (release.length < 2 || !release.every((p) => /^\d+$/.test(p))) return null
  return {
    release: release.map((p) => parseInt(p, 10)),
    // `1.2.3-beta.1` and `1.2.3-beta-1` both mean one pre-release chain.
    prerelease: preParts.join("-").split(".").filter(Boolean),
  }
}

/** Compare two pre-release identifiers per semver §11.4. */
function comparePreReleaseIds(a: string, b: string): number {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return parseInt(a, 10) - parseInt(b, 10)
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aNum) return -1
  if (bNum) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Negative when `a` precedes `b`, positive when it follows, zero when equal.
 * Returns null when either side is not a parseable version.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return null

  const len = Math.max(pa.release.length, pb.release.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa.release[i] ?? 0) - (pb.release[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }

  // Same release numbers: absence of a pre-release wins.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0
  if (pa.prerelease.length === 0) return 1
  if (pb.prerelease.length === 0) return -1

  const preLen = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let i = 0; i < preLen; i++) {
    const x = pa.prerelease[i]
    const y = pb.prerelease[i]
    // A longer pre-release chain outranks its prefix (beta.1 > beta).
    if (x === undefined) return -1
    if (y === undefined) return 1
    const diff = comparePreReleaseIds(x, y)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

/**
 * Whether `latest` is a genuine upgrade over `current`.
 *
 * Non-semver versions (a git hash, a date stamp) fall back to inequality, which
 * is the only signal available for them and preserves the previous behaviour.
 */
export function isUpgradeAvailable(
  current: string | null | undefined,
  latest: string | null | undefined,
): boolean {
  if (!current || !latest) return false
  const cmp = compareVersions(current, latest)
  if (cmp === null) return current !== latest
  return cmp < 0
}
