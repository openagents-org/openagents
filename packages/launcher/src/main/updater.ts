// ── Launcher self-update (electron-updater) ──
//
// Updates the Electron *app itself* from GitHub Releases. This is distinct from
// the agent-launcher npm "core library" update (see ensureCoreLibrary /
// checkCoreUpdate in index.ts) and from per-agent updates — those keep the
// runtime fresh, but historically the app shell could only be updated by
// uninstalling and reinstalling. This module gives the renderer a
// check → download → restart-to-install flow.
//
// Update metadata (latest.yml / latest-mac.yml / latest-linux.yml + .blockmap)
// must be present in the GitHub Release alongside the installers — see
// .github/workflows/desktop-build.yml.
import path from "path"
import { app, ipcMain, type BrowserWindow } from "electron"
import electronUpdater, {
  type UpdateInfo,
  type ProgressInfo,
  type UpdateDownloadedEvent,
} from "electron-updater"
import { launchWindowsUpdateInstaller } from "./windows-update-installer"
import { DEFAULT_LAUNCHER_FEED, launcherFeedUrl } from "./mirror"
import {
  clearInstallAttempt,
  purgePendingUpdateCache,
  readUpdaterCacheDirName,
  recordInstallAttempt,
  reconcileInstallAttempt,
  redirectUpdaterCacheToAsciiPath,
} from "./updater-cache"

// electron-updater ships CJS; grab autoUpdater off the default export so this
// keeps working whether the bundler emits ESM-interop or a bare require().
const { autoUpdater } = electronUpdater

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  latestVersion: string | null
  percent: number
  bytesPerSecond: number
  releaseNotes: string | null
  error: string | null
  // false when self-update can't run (dev build, no update metadata, etc.) —
  // the renderer falls back to a "download from website" hint.
  supported: boolean
  // Platform-specific "get the latest build" link, used by the renderer's
  // download-page fallback. Resolved in main where process.platform/arch are
  // authoritative (the renderer can't reliably tell Apple Silicon from Intel).
  downloadUrl: string
  // Set when we handed a version to the installer and came back up still on the
  // old one — the in-app update silently did nothing. The renderer turns this
  // into a "download it manually" prompt instead of letting the user retry a
  // path that has already failed twice.
  installFailedVersion: string | null
}

// Where the download-page fallback points, per OS/arch. Linux has no dedicated
// endpoint yet, so it keeps the GitHub Releases page.
const GITHUB_RELEASES_URL =
  "https://github.com/openagents-org/openagents/releases"

function resolveDownloadUrl(): string {
  if (process.platform === "win32") {
    return "https://openagents.org/api/download/launcher/windows"
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64"
      ? "https://openagents.org/api/download/launcher/mac"
      : "https://openagents.org/api/download/launcher/mac-intel"
  }
  return GITHUB_RELEASES_URL
}

let _state: UpdaterState = {
  status: "idle",
  currentVersion: "0.0.0",
  latestVersion: null,
  percent: 0,
  bytesPerSecond: 0,
  releaseNotes: null,
  error: null,
  supported: false,
  downloadUrl: resolveDownloadUrl(),
  installFailedVersion: null,
}

let _getWindow: () => BrowserWindow | null = () => null
let _log: (msg: string) => void = () => {}
let _ipcRegistered = false
// Reads the persisted "Automatic updates" setting. When true, background checks
// auto-download the update and electron-updater installs it on the next quit.
let _isAutoUpdateEnabled: () => boolean = () => false
// Fired once a background auto-download finishes, so the main process can notify
// the user and offer a "restart to update now" affordance (tray + banner).
let _onDownloaded: (version: string) => void = () => {}
// electron-updater exposes the verified NSIS path on update-downloaded. Keep it
// so Windows can use a Unicode-safe handoff when %LOCALAPPDATA% contains a
// non-ASCII username.
let _downloadedFile: string | null = null
// Resolved staging location for downloaded packages, so a failed install can
// purge the poisoned package instead of letting electron-updater replay it.
let _cacheRoot: string | null = null
let _cacheDirName: string | null = null
// True while a user-supplied mirror is in effect, so clearing the setting can
// restore the packaged origin (electron-updater has no "unset feed" API).
let _feedOverridden = false
// Version we've already written an install-attempt marker for this session.
// Both the explicit "Restart & install" path and the install-on-quit path can
// fire for the same install, and double-counting would make a single failure
// look like the second consecutive one.
let _attemptRecordedFor: string | null = null
// Guards against two downloads of the same package running at once — the
// background auto-download and a user pressing Download can otherwise overlap.
let _downloadInFlight = false

// Path to the updater config electron-updater will actually read:
// resources/app-update.yml when packaged, dev-app-update.yml otherwise. Falls
// back to the packaged location if the adapter shape ever changes.
function updaterConfigPath(): string {
  try {
    return (autoUpdater as unknown as { app: { appUpdateConfigPath: string } })
      .app.appUpdateConfigPath
  } catch {
    return path.join(process.resourcesPath, "app-update.yml")
  }
}

// Leave a marker saying we're handing `version` to the installer, so the next
// launch can tell a real install from a silent no-op.
function noteInstallAttempt(version: string): void {
  if (_attemptRecordedFor === version) return
  _attemptRecordedFor = version
  recordInstallAttempt(app.getPath("userData"), version)
}
// Runs right before quitAndInstall so the daemon + agent subprocesses are torn
// down first. On Windows the NSIS installer can't overwrite the app while a
// child process (the daemon) still holds a lock on files under the install dir —
// the overwrite silently fails and the relaunch comes back on the OLD version.
// Must be awaited before handing off to the installer.
let _beforeInstall: () => Promise<void> = async () => {}
// Undoes _beforeInstall when the handoff fails and we stay running: the daemon
// is already stopped at that point, so without this the user is left in a
// half-torn-down app with every agent offline and no indication why.
let _resumeAfterFailedInstall: () => Promise<void> = async () => {}

function emit(patch: Partial<UpdaterState>): void {
  _state = { ..._state, ...patch }
  const win = _getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send("updater:event", _state)
  }
}

function normalizeReleaseNotes(
  notes: UpdateInfo["releaseNotes"],
): string | null {
  if (!notes) return null
  if (typeof notes === "string") return notes
  // Array<{ version, note }> for the cumulative-notes case.
  return notes
    .map((n) => (n.note ? `## ${n.version}\n${n.note}` : `## ${n.version}`))
    .join("\n\n")
}

/**
 * The single place a download starts. electron-updater's own `autoDownload` is
 * pinned off (see setupAutoUpdater) because it is read inside checkForUpdates(),
 * which meant the answer to "should this download by itself?" depended on
 * whichever code path had set the flag last. Opening Settings → Updates runs a
 * check that used to force it off, so a user with automatic updates ON got
 * "found v0.8.22" and then nothing — the reported behaviour exactly. Deciding
 * here, on the event, removes that coupling entirely.
 */
async function startDownload(reason: string): Promise<void> {
  if (_downloadInFlight) return
  // Already staged — a second download would just re-verify the same file.
  if (_state.status === "downloaded") return
  _downloadInFlight = true
  _log(`[updater] downloading v${_state.latestVersion ?? "?"} (${reason})`)
  emit({ status: "downloading", percent: 0, error: null })
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    _log(`[updater] download failed: ${(err as Error).message}`)
    emit({ status: "error", error: (err as Error).message })
  } finally {
    _downloadInFlight = false
  }
}

function wireEvents(): void {
  autoUpdater.on("checking-for-update", () => {
    emit({ status: "checking", error: null })
  })
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    _log(`[updater] update available: v${info.version}`)
    emit({
      status: "available",
      latestVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      error: null,
      // A different version than the one that failed is worth another try —
      // clear the "install manually" hint so it doesn't stick forever.
      installFailedVersion:
        _state.installFailedVersion === info.version
          ? _state.installFailedVersion
          : null,
    })
    // Applies to every check — background, startup, or the one Settings fires
    // when the Updates section opens. "Automatic updates" is a user setting
    // about downloads, not about which screen happened to trigger the check.
    if (_isAutoUpdateEnabled()) {
      void startDownload("automatic updates are on")
    }
  })
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    emit({
      status: "not-available",
      latestVersion: info.version,
      error: null,
    })
  })
  autoUpdater.on("download-progress", (p: ProgressInfo) => {
    emit({
      status: "downloading",
      percent: Math.round(p.percent),
      bytesPerSecond: Math.round(p.bytesPerSecond),
    })
  })
  autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
    _downloadedFile = info.downloadedFile
    _log(`[updater] update downloaded: v${info.version}`)
    emit({
      status: "downloaded",
      percent: 100,
      latestVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    })
    try {
      _onDownloaded(info.version)
    } catch {}
  })
  autoUpdater.on("error", (err: Error) => {
    _log(`[updater] error: ${err.message}`)
    emit({ status: "error", error: err.message })
  })
}

/**
 * The handoff failed and we are still running. Put the app back into a usable
 * state and tell the renderer to stop offering a restart that does nothing —
 * quitting into an installer that never starts is precisely the "launcher just
 * exits and nothing happens" the user hit.
 */
async function abortInstall(detail: string): Promise<void> {
  _log(`[updater] ERROR install handoff failed: ${detail}`)
  ;(app as typeof app & { isQuitting: boolean }).isQuitting = false
  // A package we could not even start would fail the same way on quit, with the
  // app already gone and nothing left to report it.
  autoUpdater.autoInstallOnAppQuit = false
  // We never reached the installer, so the attempt marker would make the next
  // launch report a phantom failed install.
  clearInstallAttempt(app.getPath("userData"))
  _attemptRecordedFor = null
  // Keeps `status: "downloaded"`, so the banner and Settings both switch to the
  // "install it manually" variant instead of silently dropping the update.
  emit({ error: detail, installFailedVersion: _state.latestVersion })
  try {
    await _resumeAfterFailedInstall()
  } catch (err) {
    _log(`[updater] failed to resume after aborted install: ${(err as Error).message}`)
  }
}

// Tear down agents/daemon, then hand off to the installer. Shared by the
// Settings "Restart to install" button and the tray item so BOTH paths release
// the file locks that would otherwise make the Windows overwrite install fail.
// Returns false when the app should stay up because nothing was launched.
async function quitAndInstallSafely(): Promise<boolean> {
  // Mark quitting so the window `close` handler really quits (instead of hiding
  // to tray) and the before-quit teardown runs.
  ;(app as typeof app & { isQuitting: boolean }).isQuitting = true
  try {
    await _beforeInstall()
  } catch (err) {
    _log(`[updater] beforeInstall failed: ${(err as Error).message}`)
  }

  // Windows always goes through our own launcher rather than
  // NsisUpdater.doInstall(). That one spawns the installer, returns true
  // regardless, and BaseUpdater quits on the next tick — so a failure to start
  // (elevation required, AV quarantine, a mangled path) is invisible and the
  // app disappears without updating. launchWindowsUpdateInstaller confirms the
  // process is actually alive, and escalates through UAC when Windows demands
  // it, so "we quit" now implies "something is installing".
  if (process.platform === "win32") {
    if (!_downloadedFile) {
      await abortInstall("no staged installer on disk")
      return false
    }
    const launch = await launchWindowsUpdateInstaller(_downloadedFile, _log)
    if (!launch.ok) {
      await abortInstall(launch.detail)
      return false
    }
    _log(`[updater] ${launch.detail}`)
    // Only now is an attempt real. The installer runs after we exit, so this is
    // the last chance to leave a marker; the next launch compares it against
    // app.getVersion() to tell a real install from a silent no-op.
    if (_state.latestVersion) noteInstallAttempt(_state.latestVersion)
    // Stop BaseUpdater's on-quit hook from launching a second copy of the same
    // installer through the path we deliberately bypassed.
    autoUpdater.autoInstallOnAppQuit = false
    app.quit()
    return true
  }

  if (_state.latestVersion) noteInstallAttempt(_state.latestVersion)
  // Give the OS a tick to release the just-killed child processes' handles
  // before the installer tries to overwrite the app directory.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return true
}

function registerIpc(): void {
  if (_ipcRegistered) return
  _ipcRegistered = true

  ipcMain.handle("updater:get-state", () => _state)

  ipcMain.handle("updater:check", async () => {
    if (!_state.supported) return _state
    try {
      // Whether a found update downloads by itself is decided in the
      // update-available handler, from the live setting — not here.
      await autoUpdater.checkForUpdates()
    } catch (err) {
      emit({ status: "error", error: (err as Error).message })
    }
    return _state
  })

  ipcMain.handle("updater:download", async () => {
    if (!_state.supported) return _state
    await startDownload("user pressed Download")
    return _state
  })

  ipcMain.handle("updater:install", async () => {
    if (!_state.supported || _state.status !== "downloaded") return false
    return await quitAndInstallSafely()
  })
}

/**
 * Point electron-updater at a mirror of the release feed. Called at startup and
 * whenever the user edits the setting, so switching mirrors doesn't need a
 * restart. A blank/invalid value keeps the built-in origin from app-update.yml.
 */
export function applyUpdateFeedUrl(override: unknown): void {
  if (!_state.supported) return
  const url = launcherFeedUrl(override)
  try {
    if (url) {
      autoUpdater.setFeedURL({ provider: "generic", url })
      _log(`[updater] using update feed mirror: ${url}`)
    } else if (_feedOverridden) {
      // Switching back to the default: electron-updater has no "unset feed"
      // call, so restore the packaged origin explicitly.
      autoUpdater.setFeedURL({ provider: "generic", url: DEFAULT_LAUNCHER_FEED })
      _log(`[updater] using default update feed: ${DEFAULT_LAUNCHER_FEED}`)
    }
    _feedOverridden = url !== null
  } catch (err) {
    _log(`[updater] failed to apply update feed: ${(err as Error).message}`)
  }
}

export function setupAutoUpdater(opts: {
  getWindow: () => BrowserWindow | null
  log: (msg: string) => void
  isAutoUpdateEnabled: () => boolean
  onDownloaded: (version: string) => void
  beforeInstall: () => Promise<void>
  /** Bring the daemon back up when a handoff failed and we stay running. */
  resumeAfterFailedInstall?: () => Promise<void>
  /** Persisted `updateFeedUrl` — blank means use the packaged origin. */
  feedUrlOverride?: unknown
}): void {
  _getWindow = opts.getWindow
  _log = opts.log
  _isAutoUpdateEnabled = opts.isAutoUpdateEnabled
  _onDownloaded = opts.onDownloaded
  _beforeInstall = opts.beforeInstall
  if (opts.resumeAfterFailedInstall)
    _resumeAfterFailedInstall = opts.resumeAfterFailedInstall
  _state.currentVersion = app.getVersion()

  // Unpackaged builds get the SAME update flow as a release: electron-updater
  // reads dev-app-update.yml (repo root) once forceDevUpdateConfig is set, so
  // `npm run dev` checks the real release feed. This used to bail out with a
  // `supported: false` state and its own UI variant — which meant the update
  // banner, notifications and wording could not be exercised without cutting an
  // installer, so the one branch nobody could test was the one users saw.
  //
  // Only check + download are meaningful here; quitAndInstall can't replace a
  // dev tree, which is fine — everything up to "ready to install" is what needs
  // verifying.
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true
    _log("[updater] dev build: checking the real release feed via dev-app-update.yml")
  }

  emit({ supported: true })

  // Move the staging cache off a non-ASCII path BEFORE any check runs —
  // AppUpdater memoizes the resolved cache dir on first use. On a Chinese
  // Windows username the default %LOCALAPPDATA% location is what makes the
  // installer handoff fail in the first place.
  let previousRoot: string | null = null
  try {
    previousRoot = (autoUpdater as unknown as { app: { baseCachePath: string } })
      .app.baseCachePath
  } catch {}

  _cacheRoot = redirectUpdaterCacheToAsciiPath(autoUpdater, _log)
  const redirected = _cacheRoot !== null
  if (!_cacheRoot) _cacheRoot = previousRoot
  // Ask the adapter for the config path rather than assuming resourcesPath —
  // it resolves to dev-app-update.yml in an unpackaged build, and the cache dir
  // name differs there on purpose.
  _cacheDirName =
    readUpdaterCacheDirName(updaterConfigPath()) ?? app.getName()

  // Existing installs on a non-ASCII profile already have a staged package in
  // the old location. Nothing reads it now that the cache moved, so it's a
  // ~100MB orphan — and on these machines it's specifically a package that
  // failed to install. Reclaim the space.
  if (redirected && previousRoot && _cacheDirName) {
    purgePendingUpdateCache(previousRoot, _cacheDirName, _log)
  }

  // Did the update we handed to the installer last time actually land? A
  // package that fails to install stays in the cache, and every later check
  // revalidates it and re-emits `update-downloaded` without downloading
  // anything — so one broken install turns into an endless stream of "update
  // ready" prompts for a version the user can never reach.
  const outcome = reconcileInstallAttempt(
    app.getPath("userData"),
    _state.currentVersion,
  )
  if (outcome.kind === "succeeded") {
    _log(`[updater] confirmed running v${_state.currentVersion} after install`)
  } else if (outcome.kind === "failed") {
    _log(
      `[updater] install of v${outcome.version} did not take effect (still on v${_state.currentVersion}, attempt ${outcome.attempts})`,
    )
    if (_cacheRoot && _cacheDirName) {
      purgePendingUpdateCache(_cacheRoot, _cacheDirName, _log)
    }
    // One failure can be a user cancelling the UAC prompt. Two in a row means
    // the in-app path is broken on this machine, so stop pretending it works
    // and let the renderer offer a manual download instead.
    if (outcome.attempts >= 2) emit({ installFailedVersion: outcome.version })
  }

  // Pinned off for the whole process lifetime. electron-updater reads this
  // inside checkForUpdates(), which made the download decision depend on
  // whichever caller set it last; startDownload() owns that decision now.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  // Always pull the full installer and verify its sha512 directly, never the
  // block-by-block differential path. The delta downloader reassembles the new
  // installer from the locally-installed file plus changed blocks fetched via
  // many small HTTP range requests; on flaky / China networks (and whenever a
  // published .blockmap doesn't correspond byte-for-byte to the published
  // installer) the reassembled file fails its sha512 check — surfacing as
  // "sha512 checksum mismatch". A single full download + verify is far more
  // robust here and only costs bandwidth on the (user-driven) download.
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.logger = {
    info: (m: unknown) => _log(`[updater] ${String(m)}`),
    warn: (m: unknown) => _log(`[updater] WARN ${String(m)}`),
    error: (m: unknown) => _log(`[updater] ERROR ${String(m)}`),
    debug: () => {},
  }
  wireEvents()
  registerIpc()
  // After wireEvents so a bad mirror surfaces through the normal error path.
  applyUpdateFeedUrl(opts.feedUrlOverride)

  // autoInstallOnAppQuit means a staged package also installs when the user
  // simply quits from the tray — never touching "Restart & install". That path
  // needs the same marker, or a silent failure there leaves no evidence and the
  // cached package goes on re-announcing itself on every later check.
  app.on("before-quit", () => {
    if (
      _state.status === "downloaded" &&
      _state.latestVersion &&
      autoUpdater.autoInstallOnAppQuit
    ) {
      noteInstallAttempt(_state.latestVersion)
    }
  })
}

// Fired on launch and on an interval. When "Automatic updates" is on the
// update-available handler starts the download in the background; we then
// surface a "restart to update now" banner/tray item via _onDownloaded, and
// electron-updater installs on the next quit (autoInstallOnAppQuit). When it's
// off we still check and still emit `update-available` — the user gets the
// banner and downloads on their own click.
//
// Returns false when the check itself did not complete (offline, DNS, a VPN
// still coming up), so the caller can retry instead of leaving the user with no
// update prompt until the next scheduled check.
export async function checkForUpdatesOnStartup(): Promise<boolean> {
  if (!_state.supported) return false
  try {
    return (await autoUpdater.checkForUpdates()) !== null
  } catch (err) {
    _log(`[updater] update check failed: ${(err as Error).message}`)
    return false
  }
}

// Current updater state — used by the tray to decide whether to show a
// "restart to update" item.
export function getUpdaterState(): UpdaterState {
  return _state
}

// Quit and install a downloaded update immediately (tray / banner "restart
// now"). No-op unless a package is actually downloaded and ready.
export function installDownloadedUpdate(): boolean {
  if (!_state.supported || _state.status !== "downloaded") return false
  void quitAndInstallSafely()
  return true
}
