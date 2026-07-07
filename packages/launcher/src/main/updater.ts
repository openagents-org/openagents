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
import { app, ipcMain, type BrowserWindow } from "electron"
import electronUpdater, {
  type UpdateInfo,
  type ProgressInfo,
} from "electron-updater"

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
// Runs right before quitAndInstall so the daemon + agent subprocesses are torn
// down first. On Windows the NSIS installer can't overwrite the app while a
// child process (the daemon) still holds a lock on files under the install dir —
// the overwrite silently fails and the relaunch comes back on the OLD version.
// Must be awaited before handing off to the installer.
let _beforeInstall: () => Promise<void> = async () => {}

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
    })
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
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
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

// Tear down agents/daemon, then hand off to the installer. Shared by the
// Settings "Restart to install" button and the tray item so BOTH paths release
// the file locks that would otherwise make the Windows overwrite install fail.
async function quitAndInstallSafely(): Promise<void> {
  // Mark quitting so the window `close` handler really quits (instead of hiding
  // to tray) and the before-quit teardown runs.
  ;(app as typeof app & { isQuitting: boolean }).isQuitting = true
  try {
    await _beforeInstall()
  } catch (err) {
    _log(`[updater] beforeInstall failed: ${(err as Error).message}`)
  }
  // Give the OS a tick to release the just-killed child processes' handles
  // before the installer tries to overwrite the app directory.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

function registerIpc(): void {
  if (_ipcRegistered) return
  _ipcRegistered = true

  ipcMain.handle("updater:get-state", () => _state)

  ipcMain.handle("updater:check", async () => {
    if (!_state.supported) return _state
    try {
      // A manual check from Settings is user-driven: never auto-download here,
      // the page has its own Download button. Background checks
      // (checkForUpdatesOnStartup) are what honor the auto-update setting.
      autoUpdater.autoDownload = false
      await autoUpdater.checkForUpdates()
    } catch (err) {
      emit({ status: "error", error: (err as Error).message })
    }
    return _state
  })

  ipcMain.handle("updater:download", async () => {
    if (!_state.supported) return _state
    // Guard against a redundant download once we already have the package.
    if (_state.status === "downloaded") return _state
    try {
      emit({ status: "downloading", percent: 0, error: null })
      await autoUpdater.downloadUpdate()
    } catch (err) {
      emit({ status: "error", error: (err as Error).message })
    }
    return _state
  })

  ipcMain.handle("updater:install", async () => {
    if (!_state.supported || _state.status !== "downloaded") return false
    await quitAndInstallSafely()
    return true
  })
}

export function setupAutoUpdater(opts: {
  getWindow: () => BrowserWindow | null
  log: (msg: string) => void
  isAutoUpdateEnabled: () => boolean
  onDownloaded: (version: string) => void
  beforeInstall: () => Promise<void>
}): void {
  _getWindow = opts.getWindow
  _log = opts.log
  _isAutoUpdateEnabled = opts.isAutoUpdateEnabled
  _onDownloaded = opts.onDownloaded
  _beforeInstall = opts.beforeInstall
  _state.currentVersion = app.getVersion()

  // Dev builds have no app-update.yml — calling autoUpdater would throw. Still
  // register IPC so the renderer gets a clean "unsupported" state instead of
  // an invoke rejection.
  if (!app.isPackaged) {
    emit({ supported: false, status: "idle" })
    registerIpc()
    return
  }

  emit({ supported: true })
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
}

// Fired on launch and on an interval. When "Automatic updates" is on this
// auto-downloads the new version in the background; electron-updater then
// installs it on the next quit (autoInstallOnAppQuit), and we also surface a
// "restart to update now" banner/tray item via _onDownloaded for immediacy.
// The caller only invokes this when the setting is enabled, but we still gate
// autoDownload on the live setting so a mid-session toggle is respected.
export async function checkForUpdatesOnStartup(): Promise<void> {
  if (!_state.supported) return
  try {
    autoUpdater.autoDownload = _isAutoUpdateEnabled()
    await autoUpdater.checkForUpdates()
  } catch (err) {
    _log(`[updater] startup check failed: ${(err as Error).message}`)
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
