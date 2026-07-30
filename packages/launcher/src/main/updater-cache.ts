// ── Updater cache location + install-attempt bookkeeping ──
//
// Exists to fix the reported "I downloaded v0.8.20 but the launcher still says
// v0.8.18, with red-dot prompts for .19 AND .20 stacked up" state. Two distinct
// failure modes combine to produce it:
//
//  1. electron-updater stages the verified installer under the directory
//     returned by getAppCacheDir() — %LOCALAPPDATA% on Windows. A Chinese (or
//     any non-ASCII) Windows username therefore makes the installer path
//     non-ASCII. Several Windows handoff/elevation paths reduce that path
//     through the active OEM code page, report a successful launch, and never
//     actually replace the app: the launcher comes back up on the OLD version.
//
//  2. Once a package is staged, every later checkForUpdates() revalidates the
//     cached file by sha512 and re-emits `update-downloaded` WITHOUT
//     downloading anything (DownloadedUpdateHelper.getValidCachedUpdateFile).
//     So a version that can never install keeps producing fresh "update ready"
//     notifications on every check, for as long as the cache survives — which
//     is exactly the stacked red-dot state in the report. The version the app
//     *reports* is always app.getVersion() and was never stale; what looked
//     like a version cache was a poisoned update cache replaying itself.
//
// Fix (1) at the root by keeping the cache on an all-ASCII path, and detect (2)
// by remembering which version we last handed to the installer: if we come back
// up still older than that version the install failed, so drop the poisoned
// cache and let the next attempt re-download instead of replaying it.
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import { hasNonAsciiPathSegment } from "./windows-update-installer"

// Minimal AppAdapter surface we patch. electron-updater declares `app` as
// protected, but it is a plain instance property at runtime.
interface CacheRootHolder {
  baseCachePath: string
}

export interface InstallAttempt {
  /** Version we handed to the installer. */
  version: string
  /** Consecutive failed attempts at this version. */
  attempts: number
}

/**
 * Compare two dotted versions by major.minor.patch, ignoring any prerelease
 * suffix. Returns <0, 0 or >0. Only used to answer "did we come back up on (at
 * least) the version we tried to install?", so prerelease ordering is noise.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    String(v)
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

function ensureWritableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    // mkdir succeeding doesn't prove we may write files into it (ProgramData
    // hands out "create folder" but an admin policy can still deny writes), so
    // round-trip a probe file before committing the updater to this location.
    const probe = path.join(dir, ".oa-write-probe")
    writeFileSync(probe, "")
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/**
 * All-ASCII cache roots to try, most-preferred first. %ProgramData% is
 * machine-wide and — unlike %LOCALAPPDATA% — never derived from the username,
 * so it stays ASCII no matter what the account is called. Users\Public and a
 * drive-root directory are fallbacks for locked-down ProgramData ACLs.
 */
export function asciiCacheRootCandidates(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const out: string[] = []
  const programData = env.ProgramData || env.ALLUSERSPROFILE
  if (programData && !hasNonAsciiPathSegment(programData)) {
    out.push(path.join(programData, "OpenAgents", "updater-cache"))
  }
  const systemDrive = env.SystemDrive || "C:"
  out.push(path.join(`${systemDrive}\\`, "Users", "Public", "OpenAgents", "updater-cache"))
  out.push(path.join(`${systemDrive}\\`, "OpenAgents", "updater-cache"))
  return out.filter((p) => !hasNonAsciiPathSegment(p))
}

/**
 * Point electron-updater's staging cache at an all-ASCII directory when the
 * default one isn't (i.e. a non-ASCII Windows username). Returns the new root,
 * or null when no redirect was needed or possible.
 *
 * MUST run before the first checkForUpdates(): AppUpdater memoizes the
 * DownloadedUpdateHelper — and with it the resolved cache dir — on first use.
 */
export function redirectUpdaterCacheToAsciiPath(
  updater: unknown,
  log: (msg: string) => void = () => {},
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (process.platform !== "win32") return null
  const adapter = (updater as { app?: CacheRootHolder }).app
  if (!adapter) return null

  let currentRoot: string
  try {
    currentRoot = adapter.baseCachePath
  } catch {
    return null
  }
  // ASCII already — leave the stock location alone so we don't move the cache
  // for the overwhelming majority of installs that never had a problem.
  if (!currentRoot || !hasNonAsciiPathSegment(currentRoot)) return null

  for (const candidate of asciiCacheRootCandidates(env)) {
    if (!ensureWritableDir(candidate)) continue
    // baseCachePath is a getter on ElectronAppAdapter.prototype; an own
    // property shadows it for this instance.
    Object.defineProperty(adapter, "baseCachePath", {
      get: () => candidate,
      configurable: true,
    })
    log(
      `[updater] cache root contains non-ASCII characters (${currentRoot}) — staging updates in ${candidate} instead`,
    )
    return candidate
  }

  log(
    `[updater] WARN cache root is non-ASCII (${currentRoot}) and no ASCII fallback was writable; Windows install may fail`,
  )
  return null
}

/**
 * `updaterCacheDirName` from the updater config — the per-app folder under the
 * cache root that holds `pending/`. Takes the full config path because the file
 * differs by build: resources/app-update.yml when packaged, dev-app-update.yml
 * otherwise (electron-updater's AppAdapter.appUpdateConfigPath). Both are
 * electron-builder-shaped YAML with a single scalar here, so a line match beats
 * pulling in a YAML parser.
 */
export function readUpdaterCacheDirName(configPath: string): string | null {
  try {
    const raw = readFileSync(configPath, "utf-8")
    const m = /^updaterCacheDirName:\s*(.+)$/m.exec(raw)
    if (!m) return null
    return m[1].trim().replace(/^["']|["']$/g, "") || null
  } catch {
    return null
  }
}

/**
 * Delete the staged installer so the next check re-downloads instead of
 * replaying a package that demonstrably can't install. Clearing `pending/`
 * removes update-info.json too, which is what getValidCachedUpdateFile() keys
 * off — without it the stale package is silently reused forever.
 */
export function purgePendingUpdateCache(
  cacheRoot: string,
  cacheDirName: string,
  log: (msg: string) => void = () => {},
): boolean {
  const pending = path.join(cacheRoot, cacheDirName, "pending")
  try {
    if (!existsSync(pending)) return false
    rmSync(pending, { recursive: true, force: true })
    log(`[updater] cleared stale staged update at ${pending}`)
    return true
  } catch (err) {
    log(`[updater] failed to clear staged update: ${(err as Error).message}`)
    return false
  }
}

// ── install-attempt record ──
//
// Kept next to settings.json in userData. Reading/writing a UTF-8 path from
// Node is fine even when it contains Chinese characters — the Unicode problem
// is specific to handing paths to the Windows shell — so this file is safe
// where the staged installer is not.

function attemptFile(userDataPath: string): string {
  return path.join(userDataPath, "update-install-attempt.json")
}

export function readInstallAttempt(userDataPath: string): InstallAttempt | null {
  try {
    const raw = readFileSync(attemptFile(userDataPath), "utf-8")
    const parsed = JSON.parse(raw) as Partial<InstallAttempt>
    if (!parsed || typeof parsed.version !== "string" || !parsed.version) return null
    return {
      version: parsed.version,
      attempts: typeof parsed.attempts === "number" ? parsed.attempts : 1,
    }
  } catch {
    return null
  }
}

export function writeInstallAttempt(
  userDataPath: string,
  attempt: InstallAttempt,
): void {
  try {
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(attemptFile(userDataPath), JSON.stringify(attempt, null, 2), "utf-8")
  } catch {}
}

export function clearInstallAttempt(userDataPath: string): void {
  try {
    rmSync(attemptFile(userDataPath), { force: true })
  } catch {}
}

/**
 * Record that we are about to hand `version` to the installer, incrementing the
 * consecutive-attempt counter when it's the same version we already tried.
 */
export function recordInstallAttempt(userDataPath: string, version: string): void {
  const prev = readInstallAttempt(userDataPath)
  const attempts = prev && prev.version === version ? prev.attempts + 1 : 1
  writeInstallAttempt(userDataPath, { version, attempts })
}

export type InstallOutcome =
  | { kind: "none" }
  | { kind: "succeeded"; version: string }
  | { kind: "failed"; version: string; attempts: number }

/**
 * Compare the version we last tried to install against the version we actually
 * booted as. Running at (or above) the attempted version means the install
 * landed; running below it means the installer never replaced the app.
 *
 * Clears the record in both cases: a success is done with, and a failure has
 * already been folded into the returned attempt count by recordInstallAttempt,
 * so keeping it would re-report the same failure on every subsequent launch.
 */
export function reconcileInstallAttempt(
  userDataPath: string,
  currentVersion: string,
): InstallOutcome {
  const attempt = readInstallAttempt(userDataPath)
  if (!attempt) return { kind: "none" }
  clearInstallAttempt(userDataPath)
  if (compareVersions(currentVersion, attempt.version) >= 0) {
    return { kind: "succeeded", version: attempt.version }
  }
  return { kind: "failed", version: attempt.version, attempts: attempt.attempts }
}
