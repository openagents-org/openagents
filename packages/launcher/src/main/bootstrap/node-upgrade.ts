/**
 * Replacing an outdated portable Node with the pinned one.
 *
 * The startup check only ever asked whether `node --version` exited, so a
 * machine that got Node 22 kept it for good, whatever the launcher pinned
 * later. An installed runtime older than pinnedNodeVersion() is now replaced
 * on launch.
 *
 * The new runtime is built beside the live one and swapped in, never written
 * over it. ~/.openagents/nodejs is also the npm prefix the core library and
 * the legacy shared-prefix agents were installed into, so downloadNodejs'
 * wipe-and-extract would throw those away; and on Windows a running node.exe
 * cannot be replaced at all. Every failure before the swap leaves the old
 * runtime untouched and running, and the next launch tries again.
 */
import fs from "fs"
import path from "path"

export interface NodeUpgradeDeps {
  /** Lay a fresh runtime out in `dir` (downloadNodejs). */
  download: (
    dir: string,
    onProgress: (pct: number, detail: string) => void,
  ) => Promise<void>
  /** The runtime's `node --version`, or null when it does not run. */
  probe: (dir: string) => string | null
  /** Whether a probed version is still behind the pin. */
  outdated: (version: string) => boolean
  /** Stop anything that may be running off the old runtime. */
  stopRunning: () => Promise<void>
  log: (msg: string) => void
}

const RENAME_ATTEMPTS = 4
const RENAME_DELAY_MS = 500

/**
 * Swap `nodejsDir` for a fresh runtime. Resolves to the new version, or null
 * when the old runtime was kept; never throws.
 */
export async function upgradeNodejs(
  nodejsDir: string,
  onProgress: (pct: number, detail: string) => void,
  deps: NodeUpgradeDeps,
): Promise<string | null> {
  const staging = `${nodejsDir}.next`
  const retired = `${nodejsDir}.old`
  try {
    removeQuietly(staging)
    await deps.download(staging, onProgress)
    const version = deps.probe(staging)
    if (!version || deps.outdated(version))
      throw new Error(`downloaded runtime reports ${version ?? "no version"}`)

    await deps.stopRunning()
    // finishCarryOver runs every launch, so anything still in a retired
    // runtime by now could not be moved twice over; it has to go to make room.
    finishCarryOver(nodejsDir, deps.log)
    removeQuietly(retired)
    // Nothing has moved yet, so a refusal here (a node.exe still running)
    // costs nothing but this launch's upgrade.
    await renameWithRetry(nodejsDir, retired)
    try {
      await renameWithRetry(staging, nodejsDir)
    } catch (e) {
      fs.renameSync(retired, nodejsDir)
      throw e
    }

    const leftBehind = carryOver(retired, nodejsDir, deps.log)
    if (leftBehind.length) {
      deps.log(
        `node upgrade: kept ${retired} — could not move ${leftBehind.join(", ")}`,
      )
    } else {
      removeQuietly(retired)
    }
    deps.log(`node upgrade: now on ${version}`)
    return version
  } catch (e) {
    deps.log(
      `node upgrade failed, keeping the current runtime: ${(e as Error).message}`,
    )
    removeQuietly(staging)
    return null
  }
}

/**
 * Retry a carry-over an earlier upgrade could not finish (a module locked at
 * the time), and drop the retired runtime once it is empty of anything worth
 * keeping. Also the recovery when an upgrade lost both renames: with no
 * runtime in place the launch downloads a fresh one, and this moves the core
 * and agents back into it on the launch after.
 */
export function finishCarryOver(
  nodejsDir: string,
  log: (msg: string) => void,
): void {
  const retired = `${nodejsDir}.old`
  if (!fs.existsSync(retired) || !fs.existsSync(nodejsDir)) return
  const leftBehind = carryOver(retired, nodejsDir, log)
  if (!leftBehind.length) removeQuietly(retired)
}

/**
 * Move what the old prefix held that the new runtime does not ship: the core
 * library and legacy agents under node_modules, the prefix package.json, and
 * any bin shims npm wrote at the prefix root. Entries the new runtime already
 * has (node.exe, npm, the npm.cmd shim, bin/, lib/) stay the new ones.
 * Returns the paths that could not be moved.
 */
export function carryOver(
  fromDir: string,
  toDir: string,
  log: (msg: string) => void,
): string[] {
  const failed: string[] = []
  const move = (rel: string): void => {
    const src = path.join(fromDir, rel)
    const dest = path.join(toDir, rel)
    if (fs.existsSync(dest)) return
    try {
      fs.renameSync(src, dest)
    } catch (e) {
      log(`node upgrade: could not move ${rel}: ${(e as Error).message}`)
      failed.push(rel)
    }
  }
  for (const entry of readDirQuietly(fromDir)) {
    if (entry === "node_modules") continue
    move(entry)
  }
  const modules = readDirQuietly(path.join(fromDir, "node_modules"))
  if (modules.length)
    fs.mkdirSync(path.join(toDir, "node_modules"), { recursive: true })
  for (const entry of modules) move(path.join("node_modules", entry))
  return failed
}

/**
 * Windows refuses a rename while anything inside is open, including for a
 * moment after the process holding it has exited, and antivirus scanners
 * hold freshly written binaries briefly. Retry before giving up.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (e) {
      if (attempt >= RENAME_ATTEMPTS) throw e
      await new Promise((r) => setTimeout(r, RENAME_DELAY_MS))
    }
  }
}

function readDirQuietly(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function removeQuietly(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {}
}
