/**
 * Which Node.js the portable runtime in ~/.openagents/nodejs should be.
 *
 * Every npm agent is installed and run on that one Node, so this pin decides
 * which agent releases can run at all: openclaw 2026.9.3 raised its floor to
 * Node 24.16 and refuses to install below it. Raising the pin is also what
 * moves existing users — on launch, a runtime older than the pin is replaced
 * (see node-upgrade.ts), so bumping these constants is the whole upgrade.
 */
import os from "os"

/** The runtime every supported platform gets. */
export const NODE_VERSION = "v24.21.0"

/**
 * Node 24 needs macOS 13.5, while the launcher itself still runs on macOS 12,
 * so older Macs keep the last Node 22 instead of a runtime that cannot start.
 * Agents that need 24 are held back to a release that runs on it by
 * resolveInstallableVersion.
 */
export const LEGACY_NODE_VERSION = "v22.22.3"

/**
 * npm, pinned separately from Node: the Windows download is a bare node.exe,
 * and the startup check reinstalls npm into the prefix whenever it is missing.
 * Kept on 10 for now — every install path has been exercised against it, and
 * its engines (^18.17 || >=20.5) cover Node 24.
 */
export const NPM_VERSION = "10.9.8"

/** macOS 13.5 is Darwin 22.6.0. */
const NODE_24_MIN_DARWIN: Triple = [22, 6, 0]

type Triple = [number, number, number]

/** `v24.21.0`, `24.21.0` or a Darwin release like `21.6.0` → numbers. */
export function parseVersion(v: string | null | undefined): Triple | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec((v || "").trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/** The Node version this machine should be running. */
export function pinnedNodeVersion(
  platform: NodeJS.Platform = process.platform,
  release: string = os.release(),
): string {
  if (platform !== "darwin") return NODE_VERSION
  const darwin = parseVersion(release)
  // An unreadable release is a newer Mac than we know about, not an older one.
  if (darwin && compare(darwin, NODE_24_MIN_DARWIN) < 0)
    return LEGACY_NODE_VERSION
  return NODE_VERSION
}

/**
 * Whether an installed runtime must be replaced. Only an older one: a runtime
 * at or past the pin is left alone, and so is a version we can't read — that
 * case is the smoke test's job, which wipes and re-downloads a broken binary.
 */
export function needsNodeUpgrade(
  installed: string | null,
  pinned: string = pinnedNodeVersion(),
): boolean {
  const have = parseVersion(installed)
  const want = parseVersion(pinned)
  if (!have || !want) return false
  return compare(have, want) < 0
}
