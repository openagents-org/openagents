// FIRST import, on purpose: it defaults `windowsHide` for this process before
// anything (notably the in-process agent-launcher core) captures a
// child_process reference. Without it Windows pops a blank console window for
// every piped child. See win-console.ts.
import "./win-console"
import {
  app,
  BrowserWindow,
  dialog,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
} from "electron"
import path from "path"
import fs from "fs"
import os from "os"
import { execFile, execFileSync } from "child_process"
import { Store, settingsFilePath } from "./store"
import { isUpgradeAvailable } from "../shared/version-compare"
import { readPathEnv, writePathEnv, withPathEnv } from "./env"
import {
  AgentManager,
  type ChatStreamEvent,
  type NodeStatus,
} from "./agent-manager"
import { CliLoginManager } from "./cli-login"
import { prepareGeminiSignIn } from "./agents/gemini-signin"
import {
  ConnectionsStore,
  CredentialsStore,
  type ConnectionRecord,
} from "./connections-store"
import { probe as probeConnection } from "./connection-tester"
import {
  listMcpTargets,
  applyMcpServer,
  removeMcpServer,
  MCP_CATALOG,
} from "./mcp-config"
import {
  setupAutoUpdater,
  checkForUpdatesOnStartup,
  getUpdaterState,
  installDownloadedUpdate,
  applyUpdateFeedUrl,
} from "./updater"
import { getGitHubClient, parseGitHubRepo } from "./github-bridge"
import { GitHubBindingsStore } from "./github-bindings-store"
import {
  npmUrls,
  npmRegistryBase,
} from "./mirror"
import {
  downloadToFile,
  fetchJsonRacing,
} from "./download"
import { t, getMainLanguage, setMainLanguage } from "./i18n"
import { asPath, asName, asShellCommand } from "./ipc-input"
import {
  setNotificationsWindow,
  pushNotification,
  listNotifications,
  markRead,
  markAllRead,
  clearAll as clearAllNotifications,
  clearOne as clearOneNotification,
  clearBySource as clearNotificationsBySource,
  getPrefs as getNotifPrefs,
  setPrefs as setNotifPrefs,
  setPrefsStorage as setNotifPrefsStorage,
  type NotificationPrefs,
} from "./notifications"
import { PORTABLE_NODE_DIR } from "./agents/paths"
import {
  markUiReached,
  reportStartupError,
  slog,
  STARTUP_LOG,
} from "./bootstrap/startup-log"
import { InstallProgress } from "./install-progress"
import {
  configuredControlPort,
  startControlServer,
} from "./control-server"
import { attachRendererLogging, rendererLogPath } from "./renderer-log"
import {
  applyDownloadRegion,
  applyProxyFromSettings,
  tuneNpmRegistry,
} from "./net-config"
import { hardenWebContents, openExternalSafely } from "./web-security"
import { installApplicationMenu, isReloadShortcut } from "./app-menu"
import {
  applyThemeSource,
  createPlaceholderIcon,
  refreshTitleBarOverlay,
  setChromeDimmed,
  splashPalette,
  titleBarOverlayColors,
} from "./window-chrome"
import {
  addToPrefixPackageJson,
  canExecuteNodeBinary,
  downloadNodejs,
  ensureBundledRuntimeFirstOnPath,
  extractTarball,
  findNpmCommand,
} from "./bootstrap/node-runtime"

function execFileAsync(
  file: string,
  args: string[],
  opts: { timeout?: number; env?: NodeJS.ProcessEnv; maxBuffer?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: opts.timeout || 10000,
        env: opts.env,
        encoding: "utf-8",
        maxBuffer: opts.maxBuffer,
        // Runs `node --version` / `npm view …` on a 10-minute refresh; without
        // this each one flashes a console window on Windows.
        windowsHide: true,
      },
      (err, stdout) => {
        if (err) reject(err)
        else resolve((stdout || "").toString().trim())
      },
    )
  })
}


app.setName("OpenAgents Launcher")

// Stop macOS from popping the "<App> wants to use the keychain Safe Storage"
// password prompt. That entry is Chromium's OSCrypt key (shared with Electron's
// safeStorage) used to encrypt cookies/local storage; its keychain ACL is bound
// to the app's code signature, so every unsigned dev run / Electron upgrade
// re-triggers the prompt. We don't keep anything security-critical in Chromium
// storage, so route OSCrypt to an in-memory mock keychain — no prompt, no real
// keychain access. (Our own credential secrets are encrypted separately; see
// CredentialsStore.)
app.commandLine.appendSwitch("use-mock-keychain")

// Remote-driving hook for tests: OPENAGENTS_DEVTOOLS_PORT=9222 exposes the
// Chrome DevTools Protocol so Playwright's connectOverCDP (through an SSH
// tunnel, for a remote machine) can attach to the RUNNING app — real clicks,
// renderer console, screenshots. Gated on the env var and pinned to loopback:
// never on by default, never reachable from another host.
const devtoolsPort = process.env.OPENAGENTS_DEVTOOLS_PORT
if (devtoolsPort && /^\d+$/.test(devtoolsPort)) {
  app.commandLine.appendSwitch("remote-debugging-port", devtoolsPort)
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1")
}

const isHeadless = process.argv.includes("--headless")
if (process.argv.includes("--disable-gpu") || isHeadless) {
  app.disableHardwareAcceleration()
}

const GLOBAL_MODULES = path.join(PORTABLE_NODE_DIR, "node_modules")
const CORE_PKG = "@openagents-org/agent-launcher"

if (
  fs.existsSync(GLOBAL_MODULES) &&
  !require("module").globalPaths.includes(GLOBAL_MODULES)
) {
  require("module").globalPaths.push(GLOBAL_MODULES)
}

/**
 * Whether this profile ran the launcher before this process started.
 *
 * Read here, ahead of `new Store()` and therefore ahead of every write in the
 * run — anything that asks later is told "yes" by a profile created seconds
 * ago. Captured once, it stays true for the life of the process.
 *
 * Two traces, because neither is enough alone:
 *
 *   settings.json  — written the first time any preference changes. NOT
 *                    guaranteed on a first run: the npm-registry probe that
 *                    usually creates it bails out early on a machine with its
 *                    own ~/.npmrc, and then nothing has written it at all.
 *   Local Storage  — Chromium creates it the first time a page stores
 *                    anything, which the theme store does on the first frame.
 *                    So it is absent for exactly one launch, and present from
 *                    the second onwards.
 *
 * The release-notes dialog is what needs this. Builds before 0.9.10 left no
 * record of the version they ran, so someone arriving from one has nothing to
 * compare against — indistinguishable from a new user, and silently treated as
 * one, which is why the 0.9.9 notes never appeared for anybody. Getting this
 * answer wrong costs a user their release notes permanently, so it is logged:
 * `startup.log` is the only way to tell afterwards which way it went.
 */
const HAS_RUN_BEFORE = ((): boolean => {
  const dir = app.getPath("userData")
  // Named by hand rather than by basename: `settingsFilePath()` is the store's
  // own answer, so the two can never drift apart if the file is ever renamed.
  const traces: Array<[string, string]> = [
    ["settings.json", settingsFilePath()],
    ["Local Storage", path.join(dir, "Local Storage")],
  ]
  const found = traces.filter(([, p]) => fs.existsSync(p)).map(([name]) => name)
  slog(`profile: userData=${dir} traces=[${found.join(", ")}]`)
  return found.length > 0
})()

const store = new Store()

// Notification prefs live in settings.json like every other preference, so they
// survive a restart and travel with export/import. Wired here rather than
// imported inside ./notifications so that module keeps no dependency on the
// store. Registered at module scope because notifications can fire from the
// updater before any window exists.
setNotifPrefsStorage({
  read: () => store.get("notifications"),
  write: (prefs: NotificationPrefs) => store.set("notifications", prefs),
})

// User-controlled GPU toggle (Settings → General). disableHardwareAcceleration
// must run before app "ready", and this module scope is still pre-ready. Only
// disable when explicitly turned off (default on); the --disable-gpu / headless
// check above forces it off regardless. Takes effect after a restart.
if (store.get("gpuAcceleration") === false) {
  app.disableHardwareAcceleration()
}

const connectionsStore = new ConnectionsStore()
const credentialsStore = new CredentialsStore()
const githubBindingsStore = new GitHubBindingsStore()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let agentManager: AgentManager | null = null
let cliLogin: CliLoginManager | null = null
let coreVersion: string | null = null
// Last launcher-update version we notified about, so re-emitted
// update-downloaded events (electron-updater fires it from cache on every
// subsequent check) don't spam the same "update ready" toast.
let _lastUpdateNotifiedVersion: string | null = null

const installProgress = new InstallProgress(() => mainWindow)

let _launcherVersionCache: string | null = null
function getLauncherVersion(): string {
  if (_launcherVersionCache) return _launcherVersionCache
  try {
    _launcherVersionCache = require("../../package.json").version as string
  } catch {
    _launcherVersionCache = "0.0.0"
  }
  return _launcherVersionCache!
}

interface RuntimeInfo {
  nodeVersion: string | null
  npmVersion: string | null
  coreVersion: string | null
  latestVersion: string | null
}
const _runtimeCache: {
  value: RuntimeInfo
  stableAt: number
  latestAt: number
  refreshing: boolean
} = {
  value: {
    nodeVersion: null,
    npmVersion: null,
    coreVersion: null,
    latestVersion: null,
  },
  stableAt: 0,
  latestAt: 0,
  refreshing: false,
}
const RUNTIME_STABLE_TTL = 60_000 * 30
const RUNTIME_LATEST_TTL = 60_000 * 10


// Nothing in main is allowed to take the process down quietly. Registered at
// module scope so it covers the window between `require` and `whenReady` too.
process.on("uncaughtException", reportStartupError)
process.on("unhandledRejection", reportStartupError)


let _updateSplash:
  | ((msg: string, pct: number, detail?: string) => void)
  | null = null

async function ensureCoreLibrary(): Promise<void> {
  const corePkgPath = path.join(GLOBAL_MODULES, CORE_PKG, "package.json")
  let installedVersion: string | null = null

  if (fs.existsSync(corePkgPath)) {
    try {
      installedVersion = JSON.parse(
        fs.readFileSync(corePkgPath, "utf-8"),
      ).version
    } catch {}
  }

  try {
    // Raced across registries with a hard timeout. The previous lookup used a
    // bare https.get with NO timeout, so a registry that accepted the socket
    // and then went silent parked the splash on "Checking for updates…" with
    // nothing to time it out — indistinguishable from a hang.
    const meta = await fetchJsonRacing<{
      version?: string
      dist?: { integrity?: string }
    }>(npmUrls(`${CORE_PKG}/latest`), { log: slog })
    const latestVersion = meta?.version
    if (!latestVersion) throw new Error("core latest lookup failed")

    if (!installedVersion) {
      slog("Core library not found — installing v" + latestVersion + "...")
      if (_updateSplash)
        _updateSplash("Installing core library...", 65, "v" + latestVersion)
    } else if (latestVersion !== installedVersion) {
      slog("Core library update: v" + installedVersion + " → v" + latestVersion)
      if (_updateSplash)
        _updateSplash(
          "Updating core library...",
          65,
          "v" + installedVersion + " → v" + latestVersion,
        )
    } else {
      slog("Core library v" + installedVersion + " (already latest)")
      if (_updateSplash)
        _updateSplash("Core library up to date", 80, "v" + installedVersion)
    }

    if (!installedVersion || latestVersion !== installedVersion) {
      const tgzPath = path.join(
        os.tmpdir(),
        `agent-launcher-${latestVersion}.tgz`,
      )
      const destDir = path.join(GLOBAL_MODULES, CORE_PKG)

      // The registry publishes the tarball's integrity hash; enforcing it means
      // a mirror can serve the bytes faster but cannot serve different bytes.
      await downloadToFile(
        npmUrls(`${CORE_PKG}/-/agent-launcher-${latestVersion}.tgz`),
        tgzPath,
        {
          expectedIntegrity: meta?.dist?.integrity || null,
          onProgress: _updateSplash
            ? (pct, detail) =>
                _updateSplash?.(
                  "Downloading core library...",
                  65 + pct * 0.1,
                  detail,
                )
            : null,
          log: slog,
        },
      )
      try {
        fs.rmSync(destDir, { recursive: true, force: true })
      } catch {}
      fs.mkdirSync(destDir, { recursive: true })
      extractTarball(tgzPath, destDir)
      try {
        fs.unlinkSync(tgzPath)
      } catch {}

      const newVersion = (() => {
        try {
          return JSON.parse(fs.readFileSync(corePkgPath, "utf-8")).version
        } catch {
          return null
        }
      })()
      if (newVersion) {
        slog("Core library installed: v" + newVersion)
        if (_updateSplash)
          _updateSplash("Core library ready", 80, "v" + newVersion)
        installedVersion = newVersion
        addToPrefixPackageJson(CORE_PKG, newVersion)
      }
    }
  } catch (e: unknown) {
    slog("Core update failed: " + (e as Error).message)
    if (!installedVersion) {
      slog("Falling back to npm...")
      const npmCmd = findNpmCommand()
      if (npmCmd) {
        try {
          execFileSync(
            npmCmd.bin,
            [
              ...npmCmd.preArgs,
              "install",
              "--prefix",
              PORTABLE_NODE_DIR,
              `${CORE_PKG}@latest`,
              "--ignore-scripts",
              "--registry",
              npmRegistryBase(),
            ],
            {
              stdio: "pipe",
              timeout: 120000,
              windowsHide: true,
              env: withPathEnv(
                PORTABLE_NODE_DIR +
                  (process.platform === "win32" ? ";" : ":") +
                  readPathEnv(),
              ),
            },
          )
          try {
            installedVersion = JSON.parse(
              fs.readFileSync(corePkgPath, "utf-8"),
            ).version
          } catch {}
        } catch {}
      }
    }
  }

  coreVersion = installedVersion

  const npmCheck = path.join(
    PORTABLE_NODE_DIR,
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  )
  if (!fs.existsSync(npmCheck)) {
    slog("npm was removed by --prefix install — reinstalling...")
    try {
      const npmTgz = path.join(os.tmpdir(), "npm-reinstall.tgz")
      const npmDir = path.join(PORTABLE_NODE_DIR, "node_modules", "npm")
      await downloadToFile(npmUrls("npm/-/npm-10.9.8.tgz"), npmTgz, {
        log: slog,
      })
      fs.mkdirSync(npmDir, { recursive: true })
      extractTarball(npmTgz, npmDir)
      try {
        fs.unlinkSync(npmTgz)
      } catch {}
      slog("npm reinstalled")
    } catch (e: unknown) {
      slog("npm reinstall failed: " + (e as Error).message)
    }
  }

  if (installedVersion && agentManager) {
    agentManager.reloadCore()
  }
}

async function checkCoreUpdate(): Promise<void> {
  const npmCmd = findNpmCommand()
  if (!npmCmd) return
  try {
    const latest = execFileSync(
      npmCmd.bin,
      [...npmCmd.preArgs, "view", CORE_PKG, "version"],
      {
        encoding: "utf-8",
        timeout: 15000,
        windowsHide: true,
        env: withPathEnv(
          PORTABLE_NODE_DIR +
            (process.platform === "win32" ? ";" : ":") +
            readPathEnv(),
        ),
      },
    ).trim()

    if (coreVersion && latest && latest !== coreVersion) {
      if (mainWindow) {
        mainWindow.webContents.send("core-update-available", {
          current: coreVersion,
          latest,
        })
      }
    }
  } catch {}
}

function createWindow(): void {
  if (mainWindow) {
    if (process.platform === "darwin" && app.dock) app.dock.show()
    mainWindow.show()
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    minWidth: 1200,
    minHeight: 800,
    width: 1200,
    height: 800,
    title: "OpenAgents Launcher",
    autoHideMenuBar: true,
    // The app draws its own top edge. The system title bar was a grey plate
    // above a themed app, repeating a name and icon the rail already shows —
    // `hidden` removes the plate but keeps the real window buttons, so Windows
    // 11 Snap Layouts, double-click-to-maximise and the close affordance all
    // still come from the OS rather than from buttons we would have to draw.
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? {
          // Centred in the reserved strip: (40 - 12) / 2 ≈ 14 from the top,
          // and far enough in from the left to clear the rail's rounded corner.
          trafficLightPosition: { x: 16, y: 14 },
        }
      : { titleBarOverlay: titleBarOverlayColors() }),
    // Paints while the renderer boots, so the window does not flash white
    // before the first frame — the frame used to hide that behind its own
    // chrome. Matches `--background`, like the overlay above.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f1115" : "#f2f2f7",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"))
  }

  setNotificationsWindow(mainWindow)
  hardenWebContents(mainWindow.webContents)
  // Mirror the renderer console to ~/.openagents/renderer.log — the only
  // trace of renderer errors on machines reached over SSH.
  attachRendererLogging(mainWindow.webContents)

  // Forget any dim state at the START of a load, not at the end of one. A
  // reload can strand main holding a dim whose dialog is long gone, so it does
  // have to be cleared — but the renderer reports its own the moment its entry
  // script runs, which is long before `did-finish-load`. Clearing it there
  // overwrote the report of any dialog opened during startup — the release
  // notes are exactly that — and left the buttons bright over a scrimmed app.
  mainWindow.webContents.on("did-start-loading", () =>
    setChromeDimmed(mainWindow, false),
  )

  // Repaint the overlay once the page is up, for a window created before the
  // stored theme took effect: its buttons wear a colour nothing on screen
  // explains. Whatever the renderer has since said about a dialog is kept.
  mainWindow.webContents.on("did-finish-load", () =>
    refreshTitleBarOverlay(mainWindow),
  )

  // Full screen hides the window buttons on every platform, which leaves the
  // strip the app reserves for them holding nothing. Tell the renderer so it
  // can give the space back — see `--titlebar-h` in globals.css.
  const sendFullScreen = (v: boolean): void =>
    mainWindow?.webContents.send("window:full-screen", v)
  mainWindow.on("enter-full-screen", () => sendFullScreen(true))
  mainWindow.on("leave-full-screen", () => sendFullScreen(false))

  // Chat polling follows the window: full speed while someone is looking at it,
  // idle cadence once it is hidden or in the background. Minimising to the tray
  // is the launcher's normal resting state, not an edge case.
  const setChatForeground = (v: boolean): void =>
    agentManager?.setChatForeground(v)
  mainWindow.on("focus", () => setChatForeground(true))
  mainWindow.on("show", () => setChatForeground(true))
  mainWindow.on("restore", () => setChatForeground(true))
  mainWindow.on("blur", () => setChatForeground(false))
  mainWindow.on("hide", () => setChatForeground(false))
  mainWindow.on("minimize", () => setChatForeground(false))

  mainWindow.once("ready-to-show", () => {
    if (process.platform === "darwin" && app.dock) app.dock.show()
    mainWindow!.show()
    // On Windows, splash window (`alwaysOnTop: true`) sometimes leaves
    // focus on the desktop after it closes, so the main window appears but
    // doesn't receive clicks until the user clicks the title bar. Force the
    // focus to land on the launcher so onboarding is immediately
    // interactive.
    if (process.platform === "win32") {
      mainWindow!.focus()
      mainWindow!.moveTop()
    }
    // DevTools — dev only. Production builds (`app.isPackaged === true`) skip
    // this so end users never see the inspector pop up.
    if (!app.isPackaged) {
      mainWindow!.webContents.openDevTools({ mode: "detach" })
    }
  })

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return

    // Reload throws away everything the renderer is holding — install progress,
    // a half-finished agent login, an unsent message — and nothing in the app
    // asks for it. Dev builds keep it; shipped builds do not.
    if (app.isPackaged && isReloadShortcut(input)) {
      event.preventDefault()
      return
    }

    // DevTools toggle (F12 / Cmd+Opt+I / Ctrl+Shift+I), dev only.
    if (app.isPackaged) return
    const isToggle =
      input.key === "F12" ||
      (input.key.toLowerCase() === "i" &&
        ((process.platform === "darwin" && input.meta && input.alt) ||
          (process.platform !== "darwin" && input.control && input.shift)))
    if (isToggle) {
      event.preventDefault()
      const wc = mainWindow!.webContents
      if (wc.isDevToolsOpened()) wc.closeDevTools()
      else wc.openDevTools({ mode: "detach" })
    }
  })

  mainWindow.on("close", (e) => {
    // Honor the "Minimize to tray" setting (Settings → General, default on).
    // When off, closing the window really quits instead of hiding to the tray.
    const toTray = store.get("minimizeToTray") !== false
    if (
      toTray &&
      !(app as typeof app & { isQuitting?: boolean }).isQuitting
    ) {
      e.preventDefault()
      mainWindow!.hide()
      if (process.platform === "darwin" && app.dock) app.dock.hide()
    }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

// Apply the "Launch at login" setting (Settings → General) to the OS.
function applyStartOnBoot(): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: store.get("startOnBoot") === true,
    })
  } catch {}
}

// electron-updater does NOT use the default session: ElectronHttpExecutor
// downloads through `session.fromPartition("electron-updater", {cache: false})`
// (see its electronHttpExecutor.ts, NET_SESSION_NAME). fromPartition is
// idempotent per name, so asking for the same partition here hands us the very
// session the updater will use — setting the proxy on it is the only way the
// in-app proxy reaches update downloads.
function createTray(): void {
  // macOS: a white glyph, inset to 18pt. The menu-bar canvas is 22pt and AppKit
  // draws the image at that size, while other menu-bar extras keep their glyph
  // around 18pt inside it — full-bleed 22pt art reads as oversized next to
  // them. Electron auto-loads the matching @2x file as the Retina rep.
  //
  // Windows: the app icon, not a glyph. The notification area follows the
  // "Windows mode" setting independently of the app's own theme, so it can be
  // light or dark and a monochrome glyph is invisible against one of them —
  // a white glyph on a light taskbar was the bug. The 1.0 mark cannot solve it
  // in colour either: its top-right arc and bottom-right dot are black and
  // vanish on a dark taskbar. The opaque tile carries its own background and
  // so reads on both, and matches what Windows already shows for this app on
  // the taskbar and in the Start menu.
  //
  // Linux: panels are conventionally dark, so the white glyph stands.
  //
  // Path: in dev, assets/ sits two levels above out/main. In packaged builds
  // that directory is NOT inside app.asar — it is `directories.buildResources`,
  // which electron-builder never bundles — so it is copied to
  // Contents/Resources/assets via `extraResources` instead.
  const assetsDir = app.isPackaged
    ? path.join(process.resourcesPath, "assets")
    : path.join(__dirname, "../../assets")
  const trayIconFile =
    process.platform === "darwin"
      ? "tray-icon-mac.png"
      : process.platform === "win32"
        ? "icon.ico"
        : "tray-icon-light.png"
  let trayIcon = nativeImage.createFromPath(
    path.join(assetsDir, trayIconFile),
  )
  if (!trayIcon || trayIcon.isEmpty()) trayIcon = createPlaceholderIcon()

  tray = new Tray(trayIcon)
  tray.setToolTip(t("trayTooltip"))
  updateTrayMenu()
  tray.on("click", () => createWindow())
}

let _pendingAgentUpdates: Array<{
  name: string
  current: string | null
  latest: string | null
}> = []

function updateTrayMenu(): void {
  if (!tray) return

  const agents = agentManager
    ? (agentManager.getAgents() as Array<{ name: string; state: string }>)
    : []
  const agentItems =
    agents.length > 0
      ? agents.map((a) => ({ label: `${a.name} (${a.state})`, enabled: false }))
      : [{ label: t("trayNoAgents"), enabled: false }]

  const updateItems: Electron.MenuItemConstructorOptions[] =
    _pendingAgentUpdates.length > 0
      ? [
          { type: "separator" },
          {
            label: t("trayAgentUpdates", {
              count: _pendingAgentUpdates.length,
            }),
            enabled: false,
          },
          ..._pendingAgentUpdates.slice(0, 5).map(
            (u): Electron.MenuItemConstructorOptions => ({
              label: `${u.name}: v${u.current ?? "?"} → v${u.latest ?? "?"}`,
              click: () => {
                createWindow()
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send("navigate-to-install", u.name)
                }
              },
            }),
          ),
        ]
      : []

  // Launcher self-update: once a background download has landed, offer an
  // immediate "restart to update" instead of waiting for the next quit.
  const launcherUpdate = getUpdaterState()
  // Hidden once the handoff for this version is known to fail: the tray item
  // would offer a restart that has already proven to install nothing, and
  // unlike the banner the tray has nowhere to explain that.
  const launcherUpdateItems: Electron.MenuItemConstructorOptions[] =
    launcherUpdate.status === "downloaded" &&
    launcherUpdate.installFailedVersion !== launcherUpdate.latestVersion
      ? [
          { type: "separator" },
          {
            label: t("trayRestartToUpdate", {
              version: launcherUpdate.latestVersion ?? "?",
            }),
            click: () => {
              installDownloadedUpdate()
            },
          },
        ]
      : []

  const menu = Menu.buildFromTemplate([
    { label: t("trayOpenDashboard"), click: () => createWindow() },
    { type: "separator" },
    ...agentItems,
    ...updateItems,
    ...launcherUpdateItems,
    { type: "separator" },
    {
      label: t("trayQuit"),
      click: async () => {
        const result = await dialog.showMessageBox({
          type: "question",
          buttons: [t("quitConfirm"), t("cancel")],
          defaultId: 1,
          title: t("quitTitle"),
          message: t("quitMessage"),
          detail: t("quitDetail"),
        })
        if (result.response === 0) {
          ;(app as typeof app & { isQuitting: boolean }).isQuitting = true
          try {
            if (agentManager) await agentManager.stopAll()
          } catch {}
          app.quit()
        }
      },
    },
  ])

  tray.setContextMenu(menu)
  if (_pendingAgentUpdates.length > 0) {
    tray.setToolTip(
      _pendingAgentUpdates.length === 1
        ? t("trayTooltipUpdatesOne")
        : t("trayTooltipUpdates", { count: _pendingAgentUpdates.length }),
    )
  } else {
    tray.setToolTip(t("trayTooltip"))
  }
}

/** Agent → version we have already announced, so a re-check stays quiet. */
const _notifiedAgentUpdates = new Map<string, string>()

/**
 * Announces pending agent updates in the notification centre — the same place
 * the launcher's own update lands, so "something needs your attention" has one
 * home rather than a badge here and a card there.
 */
function notifyAgentUpdates(
  updates: Array<{ name: string; latest: string | null }>,
): void {
  // Everything got upgraded — retire the entry instead of leaving a count the
  // user already acted on sitting unread.
  if (updates.length === 0) {
    _notifiedAgentUpdates.clear()
    try {
      clearNotificationsBySource("agent-update")
    } catch {}
    return
  }

  const fresh = updates.filter(
    (u) => u.latest && _notifiedAgentUpdates.get(u.name) !== u.latest,
  )
  if (fresh.length === 0) return
  for (const u of fresh) _notifiedAgentUpdates.set(u.name, u.latest!)

  const separator = getMainLanguage() === "zh" ? "、" : ", "
  const names = updates.map((u) => u.name)
  try {
    // One rolling entry: a second unread badge for a list the user can read in
    // full from the first one is just noise.
    clearNotificationsBySource("agent-update")
    pushNotification({
      kind: "update_available",
      title:
        updates.length === 1
          ? t("agentUpdatesTitleOne", { name: names[0] })
          : t("agentUpdatesTitle", { count: updates.length }),
      body: t("agentUpdatesBody", { names: names.join(separator) }),
      source: "agent-update",
      // Clicking the entry lands on the surface that performs the upgrade —
      // and when the entry names one agent, on that agent's own page rather
      // than on a list the user then has to search. With several there is no
      // single destination, so `tab` alone sends them to the list.
      payload:
        updates.length === 1
          ? { tab: "install", agent: names[0] }
          : { tab: "install" },
      priority: "low",
    })
  } catch {}
}

async function refreshAgentUpdates(): Promise<void> {
  if (!agentManager) return
  try {
    const all = await agentManager.checkAgentUpdates({ force: true })
    _pendingAgentUpdates = all.filter((u) =>
      isUpgradeAvailable(u.current, u.latest),
    )
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("agent-updates-changed", _pendingAgentUpdates)
    }
    updateTrayMenu()
    notifyAgentUpdates(_pendingAgentUpdates)
  } catch {}
}

// Bundled-only resolver — matches legacy. Settings/runtime info should
// reflect the launcher's own runtime, not whatever happens to be on PATH.
function resolveBundledNode(): string | null {
  const candidates = [
    path.join(
      PORTABLE_NODE_DIR,
      process.platform === "win32" ? "node.exe" : "node",
    ),
    path.join(PORTABLE_NODE_DIR, "bin", "node"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

function resolveNpmInvocation(): { node: string; args: string[] } | null {
  const nodeBin = resolveBundledNode()
  if (!nodeBin) return null
  const candidates = [
    path.join(PORTABLE_NODE_DIR, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(
      PORTABLE_NODE_DIR,
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ]
  const npmCli = candidates.find((p) => fs.existsSync(p))
  if (npmCli) return { node: nodeBin, args: [npmCli] }
  if (process.platform !== "win32") {
    const npmBin = path.join(PORTABLE_NODE_DIR, "bin", "npm")
    if (fs.existsSync(npmBin)) return { node: npmBin, args: [] }
  }
  return null
}

async function refreshRuntimeInfo(force = false): Promise<RuntimeInfo> {
  const now = Date.now()
  const info = _runtimeCache.value
  info.coreVersion = coreVersion || info.coreVersion || null

  if (_runtimeCache.refreshing) return info
  const needStable =
    force ||
    !info.nodeVersion ||
    !info.npmVersion ||
    now - _runtimeCache.stableAt > RUNTIME_STABLE_TTL
  const needLatest =
    force ||
    !info.latestVersion ||
    now - _runtimeCache.latestAt > RUNTIME_LATEST_TTL
  if (!needStable && !needLatest) return info

  _runtimeCache.refreshing = true
  try {
    const env = withPathEnv(
      PORTABLE_NODE_DIR +
        (process.platform === "win32" ? ";" : ":") +
        readPathEnv(),
    )
    const npm = resolveNpmInvocation()

    if (needStable) {
      const nodeBin = resolveBundledNode()
      if (nodeBin) {
        try {
          info.nodeVersion = await execFileAsync(nodeBin, ["--version"], {
            timeout: 5000,
          })
        } catch {}
      } else {
        info.nodeVersion = null
      }
      if (npm) {
        try {
          info.npmVersion = await execFileAsync(
            npm.node,
            [...npm.args, "--version"],
            { timeout: 5000, env },
          )
        } catch {}
      } else {
        info.npmVersion = null
      }
      _runtimeCache.stableAt = now
    }

    if (needLatest) {
      if (npm) {
        try {
          info.latestVersion = await execFileAsync(
            npm.node,
            [...npm.args, "view", CORE_PKG, "version"],
            { timeout: 10_000, env },
          )
        } catch {}
      }
      _runtimeCache.latestAt = now
    }
  } finally {
    _runtimeCache.refreshing = false
  }
  return info
}

function setupIPC(): void {
  ipcMain.handle("python:status", () => ({
    pythonPath: null,
    pythonFound: true,
    sdkInstalled: true,
    sdkVersion: coreVersion || "not installed",
    launcherVersion: getLauncherVersion(),
    runtime: "node",
  }))
  ipcMain.handle("python:install", () => ({
    success: true,
    message: "No installation needed — using Node.js agent-connector",
  }))

  ipcMain.handle("runtime:info", async (_e, opts?: { force?: boolean }) => {
    const force = !!(opts && opts.force)
    const info = _runtimeCache.value
    const needStable = force || !info.nodeVersion || !info.npmVersion
    if (needStable && !_runtimeCache.refreshing) {
      _runtimeCache.refreshing = true
      try {
        const env = withPathEnv(
          PORTABLE_NODE_DIR +
            (process.platform === "win32" ? ";" : ":") +
            readPathEnv(),
        )
        const npm = resolveNpmInvocation()
        const nodeBin = resolveBundledNode()
        if (nodeBin) {
          try {
            info.nodeVersion = await execFileAsync(nodeBin, ["--version"], {
              timeout: 5000,
            })
          } catch {}
        } else {
          info.nodeVersion = null
        }
        if (npm) {
          try {
            info.npmVersion = await execFileAsync(
              npm.node,
              [...npm.args, "--version"],
              { timeout: 5000, env },
            )
          } catch {}
        } else {
          info.npmVersion = null
        }
        _runtimeCache.stableAt = Date.now()
      } finally {
        _runtimeCache.refreshing = false
      }
    }
    info.coreVersion = coreVersion || info.coreVersion || null
    const needLatest =
      force ||
      !info.latestVersion ||
      Date.now() - _runtimeCache.latestAt > RUNTIME_LATEST_TTL
    if (needLatest) {
      // Don't block IPC on the network call. Refresh in background.
      void refreshRuntimeInfo(force).catch(() => {})
    }
    return { ...info }
  })

  const requireManager = (): AgentManager => {
    if (!agentManager)
      throw new Error("Launcher is still initializing, please wait a moment")
    return agentManager
  }

  ipcMain.handle("agents:list", () =>
    agentManager ? agentManager.getAgents() : [],
  )
  ipcMain.handle("agents:supported-types", () =>
    agentManager ? agentManager.getSupportedAgentTypes() : [],
  )
  ipcMain.handle("agents:core-info", () =>
    agentManager
      ? agentManager.getCoreInfo()
      : { version: null, supportedTypes: [], globalCorePresent: false },
  )
  ipcMain.handle("agents:add", (_e, config) =>
    requireManager().addAgent(config),
  )
  ipcMain.handle("agents:remove", (_e, name) =>
    requireManager().removeAgent(name),
  )
  ipcMain.handle("agents:update", (_e, name, config) =>
    requireManager().updateAgent(name, config),
  )
  ipcMain.handle("agents:set-workdir", (_e, name: string, dir: string) =>
    requireManager().setAgentWorkingDir(
      asName(name, "agent name"),
      asPath(dir, "working directory"),
    ),
  )

  ipcMain.handle("agents:start", (_e, name) =>
    requireManager().startAgent(name),
  )
  ipcMain.handle("agents:stop", (_e, name) => requireManager().stopAgent(name))
  ipcMain.handle("agents:start-all", () => requireManager().startAll())
  ipcMain.handle("agents:stop-all", () => requireManager().stopAll())
  ipcMain.handle("agents:status", () =>
    agentManager ? agentManager.getAllStatus() : {},
  )
  ipcMain.handle("agents:daemon-status", () => {
    if (!agentManager) return { state: "starting", pid: null }
    try {
      return agentManager.getDaemonState()
    } catch {
      return { state: "offline", pid: null }
    }
  })
  ipcMain.handle("agents:logs", (_e, name, lines) =>
    requireManager().getLogs(name, lines),
  )
  ipcMain.handle("agents:tail-logs", (_e, name, lines, offset) => {
    if (!agentManager) return { lines: [], size: 0 }
    try {
      return agentManager.tailLogs(name, lines, offset)
    } catch {
      return { lines: [], size: 0 }
    }
  })
  ipcMain.handle("agents:clear-logs-range", (_e, start, end) =>
    requireManager().clearLogsInRange(start, end),
  )

  ipcMain.handle("agents:install-type", (_e, agentType) => {
    ensureBundledRuntimeFirstOnPath()
    return requireManager().installAgentType(agentType)
  })
  ipcMain.handle("agents:install-type-streaming", async (_e, agentType) => {
    ensureBundledRuntimeFirstOnPath()
    const verb = agentManager?.getInstalledVersion(agentType)
      ? "update"
      : "install"
    try {
      const result = await installProgress.run(agentType, verb, (cb) =>
        // Updating and installing are not the same npm operation — a bare
        // `npm install <pkg>` no-ops ("up to date") once package.json holds a
        // satisfied range, so updates have to pin @latest. See
        // AgentManager.updateAgentTypeStreaming.
        verb === "update"
          ? requireManager().updateAgentTypeStreaming(agentType, cb)
          : requireManager().installAgentTypeStreaming(agentType, cb),
      )
      // installAgentTypeStreaming clears the updates cache. Re-fetch now so
      // the next `checkAgentUpdates()` call (from the post-job refresh) gets
      // fresh data instead of an empty cache — otherwise a just-updated agent
      // could keep showing "Update available" because the renderer overrides
      // its store with the empty list before the hourly background refresh.
      // Await the refresh before returning so the renderer's follow-up
      // useEffect → checkAgentUpdates() call (no `force`) sees the freshly
      // populated cache instead of the empty value clearCatalogCache() just
      // wrote. Without the await, the rollback / install / uninstall returns,
      // the detail page re-fetches, gets `[]`, and the "Update to v…" button
      // disappears even when one is genuinely available.
      await refreshAgentUpdates().catch(() => {})
      return result
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  })
  ipcMain.handle("agents:uninstall-type", (_e, agentType) => {
    ensureBundledRuntimeFirstOnPath()
    return requireManager().uninstallAgentType(agentType)
  })
  ipcMain.handle("agents:uninstall-type-streaming", async (_e, agentType) => {
    ensureBundledRuntimeFirstOnPath()
    try {
      const result = await installProgress.run(agentType, "uninstall", (cb) =>
        requireManager().uninstallAgentTypeStreaming(agentType, cb),
      )
      // Await the refresh before returning so the renderer's follow-up
      // useEffect → checkAgentUpdates() call (no `force`) sees the freshly
      // populated cache instead of the empty value clearCatalogCache() just
      // wrote. Without the await, the rollback / install / uninstall returns,
      // the detail page re-fetches, gets `[]`, and the "Update to v…" button
      // disappears even when one is genuinely available.
      await refreshAgentUpdates().catch(() => {})
      return result
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle("agents:installed-list", () =>
    agentManager ? agentManager.listInstalledAgents() : [],
  )
  // `force` skips the hour-long probe cache. Background polls leave it unset;
  // a refresh the user asked for passes it, otherwise pressing refresh inside
  // that hour re-rendered the exact same numbers and looked like a dead button.
  ipcMain.handle("agents:check-updates", async (_e, force?: boolean) => {
    if (!agentManager) return []
    try {
      return await agentManager.checkAgentUpdates({ force: !!force })
    } catch {
      return []
    }
  })
  // Stage.md §2.5 — install at an arbitrary version/dist-tag. The renderer
  // uses this for update-channel switches (Beta / Nightly) and any future
  // "install specific version" flows. Shares the streaming + post-job
  // cache-refresh harness with install / uninstall / rollback.
  ipcMain.handle("agents:rollback", async (_e, agentType) => {
    if (!agentManager) return { success: false, error: "Launcher initializing" }
    ensureBundledRuntimeFirstOnPath()
    try {
      const result = await installProgress.run(agentType, "rollback", (cb) =>
        agentManager!.rollbackAgentType(agentType, cb),
      )
      // Await the refresh before returning so the renderer's follow-up
      // useEffect → checkAgentUpdates() call (no `force`) sees the freshly
      // populated cache instead of the empty value clearCatalogCache() just
      // wrote. Without the await, the rollback / install / uninstall returns,
      // the detail page re-fetches, gets `[]`, and the "Update to v…" button
      // disappears even when one is genuinely available.
      await refreshAgentUpdates().catch(() => {})
      return result
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  })
  ipcMain.handle("agents:changelog", async (_e, agentType) => {
    if (!agentManager) return { versions: [], error: "Launcher initializing" }
    try {
      return await agentManager.getAgentChangelog(agentType)
    } catch (e: unknown) {
      return { versions: [], error: (e as Error).message }
    }
  })
  ipcMain.handle("agents:check-type", (_e, agentType) => {
    if (!agentManager) return { installed: false, binary: null }
    try {
      return agentManager.checkAgentType(agentType)
    } catch {
      return { installed: false, binary: null }
    }
  })
  ipcMain.handle("agents:catalog", async (_e, force?: boolean) => {
    if (!agentManager) return []
    try {
      return await agentManager.getCatalog(!!force)
    } catch (err: unknown) {
      slog(`agents:catalog failed: ${(err as Error)?.message || err}`)
      return []
    }
  })

  ipcMain.handle("agents:env-fields", (_e, agentType) =>
    requireManager().getEnvFields(agentType),
  )
  ipcMain.handle("agents:get-env", (_e, agentType) =>
    requireManager().getAgentEnv(agentType),
  )
  ipcMain.handle("agents:save-env", (_e, agentType, env) =>
    requireManager().saveAgentEnv(agentType, env),
  )
  ipcMain.handle("agents:delete-env", (_e, agentType) =>
    requireManager().deleteAgentEnv(agentType),
  )
  ipcMain.handle("agents:get-instance-env", (_e, agentName) =>
    requireManager().getAgentInstanceEnv(agentName),
  )
  ipcMain.handle("agents:save-instance-env", (_e, agentName, env) =>
    requireManager().saveAgentInstanceEnv(agentName, env),
  )
  ipcMain.handle("agents:test-llm", (_e, env) => requireManager().testLLM(env))
  ipcMain.handle("agents:list-models", (_e, agentType, env, path) =>
    requireManager().listModels(agentType, env, path),
  )
  ipcMain.handle("agents:signal-reload", () => requireManager().signalReload())

  // ── Chat IPC (Stage 3.1) ──
  ipcMain.handle("workspace:send-message", (_e, input) =>
    requireManager().sendChatMessage(input),
  )
  ipcMain.handle(
    "workspace:get-messages",
    (_e, workspaceId, channelName, limit) =>
      requireManager().getChatMessages(workspaceId, channelName, limit),
  )
  ipcMain.handle("workspace:get-all-messages", (_e, workspaceId, limit) =>
    requireManager().getWorkspaceMessages(workspaceId, limit),
  )
  ipcMain.handle("workspace:start-polling", (_e, workspaceId, channelName) => {
    const res = requireManager().startChatPolling(workspaceId, channelName)
    return res ? { success: true, key: res.key } : { success: false }
  })
  ipcMain.handle("workspace:stop-polling", (_e, workspaceId, channelName) => {
    agentManager?.stopChatPolling(workspaceId, channelName)
    return { success: true }
  })
  ipcMain.handle("workspace:list-participants", (_e, workspaceId) =>
    requireManager().listChatParticipants(workspaceId),
  )

  ipcMain.handle(
    "workspace:upload-file",
    (_e, workspaceId, filename, contentBase64, opts) =>
      requireManager().uploadChatFile(
        workspaceId,
        filename,
        contentBase64,
        opts || {},
      ),
  )
  ipcMain.handle("workspace:list-files", (_e, workspaceId, opts) =>
    requireManager().listChatFiles(workspaceId, opts || {}),
  )
  ipcMain.handle("workspace:read-file", (_e, workspaceId, fileId) =>
    requireManager().readChatFile(workspaceId, fileId),
  )
  ipcMain.handle("workspace:delete-file", (_e, workspaceId, fileId) =>
    requireManager().deleteChatFile(workspaceId, fileId),
  )

  ipcMain.handle("session:list", (_e, workspaceId) =>
    requireManager().listChatSessions(workspaceId),
  )
  ipcMain.handle("session:create", (_e, workspaceId) =>
    requireManager().createChatSession(workspaceId),
  )
  ipcMain.handle("session:load", (_e, workspaceId, channelName) =>
    requireManager().loadChatSession(workspaceId, channelName),
  )
  ipcMain.handle("session:delete", (_e, workspaceId, channelName) =>
    requireManager().deleteChatSession(workspaceId, channelName),
  )
  ipcMain.handle("session:clear", (_e, workspaceId) =>
    requireManager().clearChatSessions(workspaceId),
  )

  ipcMain.handle("workspace:connect", (_e, agentName, slug) =>
    requireManager().connectWorkspace(agentName, slug),
  )
  ipcMain.handle("workspace:disconnect", (_e, agentName) =>
    requireManager().disconnectWorkspace(agentName),
  )
  ipcMain.handle("workspace:remove", (_e, slug, opts) =>
    requireManager().removeWorkspace(slug, opts || {}),
  )
  ipcMain.handle("workspace:list", () =>
    agentManager ? agentManager.getNetworks() : [],
  )
  // Server-side rename — everyone in the workspace sees it. The dialog's
  // default path (local alias) never reaches the main process at all.
  ipcMain.handle("workspace:rename", (_e, workspaceId, name) =>
    requireManager().renameWorkspace(workspaceId, name),
  )

  // ── Connect this device (node pairing) ──
  // Status is read from disk, so it answers even before the core loads.
  ipcMain.handle("node:status", (): NodeStatus => {
    if (agentManager) return agentManager.getNodeStatus()
    return {
      connected: false,
      nodeId: null,
      workspaceId: null,
      workspaceSlug: null,
      workspaceName: null,
      endpoint: null,
      hostname: os.hostname(),
      deviceType: "unknown",
      workspaces: [],
      revoked: [],
    }
  })
  // Verified against the workspace (throttled in the manager), so a device the
  // workspace has since removed stops being reported as paired here.
  ipcMain.handle("node:refresh", (_e, force) =>
    agentManager
      ? agentManager.refreshNodeStatus(!!force)
      : Promise.resolve({
          connected: false,
          nodeId: null,
          workspaceId: null,
          workspaceSlug: null,
          workspaceName: null,
          endpoint: null,
          hostname: os.hostname(),
          deviceType: "unknown",
          workspaces: [],
          revoked: [],
        }),
  )
  ipcMain.handle("node:connect", (_e, code, opts) =>
    requireManager().connectNode(code, opts || {}),
  )
  // Native folder picker for onboarding's "Create your first agent" step. The
  // chosen directory becomes the agent's working directory. Returns null when
  // the user cancels.
  ipcMain.handle(
    "dialog:select-directory",
    async (_e, defaultPath?: string) => {
      const win = BrowserWindow.getFocusedWindow() || mainWindow
      const opts = {
        properties: ["openDirectory", "createDirectory"] as Array<
          "openDirectory" | "createDirectory"
        >,
        ...(defaultPath ? { defaultPath } : {}),
      }
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
      if (result.canceled || !result.filePaths?.length) return null
      return result.filePaths[0]
    },
  )

  // ── Onboarding ──
  // Runnable-only picker + atomic, verified provisioning. See agent-manager.ts.
  ipcMain.handle("onboarding:agents", async () => {
    if (!agentManager) return []
    try {
      return await agentManager.getOnboardingAgents()
    } catch (err: unknown) {
      slog(`onboarding:agents failed: ${(err as Error)?.message || err}`)
      return []
    }
  })
  ipcMain.handle("onboarding:provision", (_e, opts) =>
    requireManager().provisionFirstAgent(opts),
  )
  // Renderer consumes the post-upgrade reset flag (set by the startup
  // migration) to clear its onboarding localStorage and re-open the flow.
  // Read-and-clear so it only fires once.
  ipcMain.handle("onboarding:consume-reset", () => {
    const pending = !!store.get("pendingOnboardingReset")
    if (pending) store.delete("pendingOnboardingReset")
    return pending
  })
  // The renderer owns the theme; this is how the OS-drawn window frame hears
  // about it. Persisted so the next launch can set it before the first window
  // opens (see the whenReady call).
  // Answered on subscribe, so the renderer starts from the truth rather than
  // from a default it has to correct a frame later.
  ipcMain.handle(
    "window:is-full-screen",
    () => mainWindow?.isFullScreen() ?? false,
  )

  ipcMain.handle("theme:set-source", (_e, mode: unknown) => {
    applyThemeSource(mode)
    store.set("themeMode", nativeTheme.themeSource)
  })

  // Dialogs scrim the page, but the window buttons are drawn by the OS on top
  // of it — the renderer says when one is open so the overlay can be repainted
  // to match. See setChromeDimmed.
  ipcMain.handle("window:chrome-dim", (_e, dim: unknown) => {
    setChromeDimmed(mainWindow, dim === true)
  })

  ipcMain.handle("settings:get", (_e, key) => store.get(key))
  ipcMain.handle("settings:set", (_e, key, value) => {
    store.set(key, value)
    if (key === "workspaceEndpoint" && agentManager) {
      agentManager.reloadCore()
    }
    if (key === "startOnBoot") applyStartOnBoot()
    // Keep main's notification/tray strings on the language the user picked in
    // Settings — main can't read the renderer's localStorage-backed i18next.
    if (key === "language") {
      setMainLanguage(value)
      updateTrayMenu()
    }
    if (key === "httpProxy" || key === "httpsProxy" || key === "noProxy") {
      applyProxyFromSettings(store)
    }
    // Download acceleration: re-point npm (and therefore core/agent installs)
    // at the mirror without needing a restart. Node dist URLs are resolved per
    // download, so they pick the new region up on their own.
    if (key === "downloadRegion") applyDownloadRegion(value)
    if (key === "updateFeedUrl") applyUpdateFeedUrl(value)
  })

  // ── Connections ──
  ipcMain.handle("connections:list", () => connectionsStore.list())
  ipcMain.handle("connections:upsert", (_e, record) =>
    connectionsStore.upsert(record),
  )
  ipcMain.handle("connections:remove", (_e, id) => connectionsStore.remove(id))
  ipcMain.handle("connections:set-status", (_e, id, status, lastError) =>
    connectionsStore.setStatus(id, status, lastError),
  )
  ipcMain.handle("connections:test", async (_e, id) => {
    const conn = connectionsStore.get(id)
    if (!conn)
      return { ok: false, status: "error", detail: "Connection not found" }
    if (!conn.credentialId) {
      connectionsStore.setStatus(id, "unauthorized", "No credential linked")
      return {
        ok: false,
        status: "unauthorized",
        detail: "No credential linked",
      }
    }
    const secret = credentialsStore.getSecret(conn.credentialId)
    if (!secret) {
      connectionsStore.setStatus(id, "unauthorized", "Credential missing")
      return { ok: false, status: "unauthorized", detail: "Credential missing" }
    }
    const result = await probeConnection(conn.platform, secret)
    connectionsStore.setStatus(
      id,
      result.status as ConnectionRecord["status"],
      result.detail,
    )
    if (result.account) {
      connectionsStore.upsert({
        id,
        platform: conn.platform,
        account: result.account,
      })
    }
    credentialsStore.recordTest(conn.credentialId, result.ok, result.detail)
    return result
  })

  // ── MCP registration ──
  //
  // An .env key is enough for agents that read it natively (gemini), but for
  // claude/cursor the usable form of a connection is an MCP server. These
  // handlers register the platform's hosted endpoint in each agent's own
  // config, authenticated with the stored credential.

  /** Platform ids that have a hosted MCP endpoint we know how to register. */
  ipcMain.handle("mcp:platforms", () => Object.keys(MCP_CATALOG))

  ipcMain.handle("mcp:list-targets", (_e, platform: string) =>
    listMcpTargets(platform),
  )

  ipcMain.handle(
    "mcp:apply",
    (_e, payload: { connectionId: string; targetIds: string[] }) => {
      const { connectionId, targetIds } = payload || {}
      if (!connectionId || !Array.isArray(targetIds) || targetIds.length === 0) {
        return { ok: false, written: [], errors: ["Missing connectionId / targetIds"] }
      }
      const conn = connectionsStore.get(connectionId)
      if (!conn)
        return { ok: false, written: [], errors: ["Connection not found"] }
      if (!conn.credentialId)
        return { ok: false, written: [], errors: ["No credential linked"] }
      const secret = credentialsStore.getSecret(conn.credentialId)
      if (!secret)
        return { ok: false, written: [], errors: ["Credential missing"] }
      return applyMcpServer(conn.platform, secret, targetIds)
    },
  )

  ipcMain.handle(
    "mcp:remove",
    (_e, payload: { platform: string; targetIds: string[] }) => {
      const { platform, targetIds } = payload || {}
      if (!platform || !Array.isArray(targetIds) || targetIds.length === 0) {
        return { ok: false, written: [], errors: ["Missing platform / targetIds"] }
      }
      return removeMcpServer(platform, targetIds)
    },
  )

  // ── Credentials ──
  ipcMain.handle("credentials:list", () => credentialsStore.list())
  ipcMain.handle("credentials:upsert", (_e, input) =>
    credentialsStore.upsert(input),
  )
  ipcMain.handle("credentials:remove", (_e, id) => {
    const removed = credentialsStore.remove(id)
    if (removed) {
      connectionsStore.unlinkCredential(id)
      githubBindingsStore.unlinkCredential(id)
    }
    return removed
  })
  ipcMain.handle("credentials:reveal", (_e, id) => credentialsStore.reveal(id))
  ipcMain.handle(
    "credentials:test",
    async (
      _e,
      payload: {
        id?: string
        provider: string
        secret?: string
      },
    ) => {
      let secret = payload.secret
      if (!secret && payload.id)
        secret = credentialsStore.getSecret(payload.id) || undefined
      if (!secret)
        return { ok: false, status: "error", detail: "No secret provided" }
      const result = await probeConnection(payload.provider, secret)
      if (payload.id)
        credentialsStore.recordTest(payload.id, result.ok, result.detail)
      return result
    },
  )

  /**
   * Apply a credential to one or more agent types' .env files. Bridges the new
   * encrypted Credentials store to the legacy ~/.openagents/env/<type>.env
   * system that resolve_env already understands (stage.md §4.4 — image:
   * "src/env.js 增强"). Existing keys in the file are preserved; only the
   * requested envKey is overwritten.
   */
  ipcMain.handle(
    "credentials:apply-to-agents",
    async (
      _e,
      payload: { credentialId: string; envKey: string; agentTypes: string[] },
    ) => {
      const { credentialId, envKey, agentTypes } = payload
      if (
        !credentialId ||
        !envKey ||
        !Array.isArray(agentTypes) ||
        agentTypes.length === 0
      ) {
        return {
          ok: false,
          error: "Missing credentialId / envKey / agentTypes",
        }
      }
      const secret = credentialsStore.getSecret(credentialId)
      if (!secret) return { ok: false, error: "Credential not found" }
      if (!agentManager) return { ok: false, error: "Agent manager not ready" }
      const written: string[] = []
      const errors: string[] = []
      for (const type of agentTypes) {
        try {
          const existing =
            (agentManager.getAgentEnv(type) as Record<string, string>) || {}
          const next = { ...existing, [envKey]: secret }
          agentManager.saveAgentEnv(type, next)
          written.push(type)
        } catch (e) {
          errors.push(`${type}: ${(e as Error).message}`)
        }
      }
      // Track the linkage in the credential's usedByAgents.
      try {
        const all = credentialsStore.list().find((c) => c.id === credentialId)
        const next = new Set([...(all?.usedByAgents || []), ...written])
        credentialsStore.upsert({
          id: credentialId,
          provider: all!.provider,
          kind: all!.kind,
          label: all!.label,
          shared: all!.shared,
          scopes: all!.scopes,
          usedByAgents: Array.from(next),
        })
      } catch {}
      return { ok: errors.length === 0, written, errors }
    },
  )

  // ── GitHub Integration (4.3) ──
  //
  // Per-agent repo bindings stored in <userData>/github-bindings.json.
  // Tokens are never stored here — they're resolved at request time from the
  // encrypted Credentials store using the binding's credentialId.

  const resolveGitHubToken = (credentialId: string): string | null =>
    credentialsStore.getSecret(credentialId)

  ipcMain.handle(
    "github:probe",
    async (_e, payload: { credentialId?: string; secret?: string }) => {
      const token =
        payload.secret ||
        (payload.credentialId ? resolveGitHubToken(payload.credentialId) : null)
      if (!token) return { ok: false, error: "Missing GitHub token" }
      try {
        const r = await getGitHubClient().probe(token)
        return { ...r, ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle("github:parse-repo", (_e, input: string) =>
    parseGitHubRepo(input),
  )

  ipcMain.handle("github:list-bindings", () => githubBindingsStore.list())

  ipcMain.handle(
    "github:bind-repo",
    async (
      _e,
      payload: { agentName: string; repo: string; credentialId: string },
    ) => {
      const parsed = parseGitHubRepo(payload.repo)
      if (!parsed)
        return {
          ok: false,
          error: "Could not parse repo (use owner/name or URL)",
        }
      const token = resolveGitHubToken(payload.credentialId)
      if (!token) return { ok: false, error: "Credential not found" }
      try {
        await getGitHubClient().getRepo(parsed.owner, parsed.name, token)
      } catch (e) {
        return {
          ok: false,
          error: `Cannot access ${parsed.owner}/${parsed.name}: ${(e as Error).message}`,
        }
      }
      const binding = githubBindingsStore.upsert({
        agentName: payload.agentName,
        owner: parsed.owner,
        repo: parsed.name,
        credentialId: payload.credentialId,
      })
      return { ok: true, binding }
    },
  )

  ipcMain.handle("github:unbind-repo", (_e, agentName: string) =>
    githubBindingsStore.remove(agentName),
  )

  ipcMain.handle(
    "github:list-issues",
    async (
      _e,
      payload: {
        agentName: string
        state?: "open" | "closed" | "all"
        perPage?: number
        page?: number
      },
    ) => {
      const binding = githubBindingsStore.get(payload.agentName)
      if (!binding) return { ok: false, error: "Agent is not bound to a repo" }
      const token = resolveGitHubToken(binding.credentialId)
      if (!token)
        return { ok: false, error: "Credential missing for this binding" }
      try {
        const items = await getGitHubClient().listIssues(
          binding.owner,
          binding.repo,
          {
            state: payload.state,
            perPage: payload.perPage,
            page: payload.page,
          },
          token,
        )
        return { ok: true, items }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    "github:list-pull-requests",
    async (
      _e,
      payload: {
        agentName: string
        state?: "open" | "closed" | "all"
        perPage?: number
        page?: number
      },
    ) => {
      const binding = githubBindingsStore.get(payload.agentName)
      if (!binding) return { ok: false, error: "Agent is not bound to a repo" }
      const token = resolveGitHubToken(binding.credentialId)
      if (!token)
        return { ok: false, error: "Credential missing for this binding" }
      try {
        const items = await getGitHubClient().listPullRequests(
          binding.owner,
          binding.repo,
          {
            state: payload.state,
            perPage: payload.perPage,
            page: payload.page,
          },
          token,
        )
        return { ok: true, items }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    "github:comment",
    async (
      _e,
      payload: { agentName: string; issueNumber: number; body: string },
    ) => {
      const binding = githubBindingsStore.get(payload.agentName)
      if (!binding) return { ok: false, error: "Agent is not bound to a repo" }
      const token = resolveGitHubToken(binding.credentialId)
      if (!token)
        return { ok: false, error: "Credential missing for this binding" }
      if (!payload.body || !payload.body.trim()) {
        return { ok: false, error: "Comment body is empty" }
      }
      try {
        const result = await getGitHubClient().createIssueComment(
          binding.owner,
          binding.repo,
          payload.issueNumber,
          payload.body,
          token,
        )
        return { ok: true, result }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  // ── Notifications (5.4) ──
  ipcMain.handle("notifications:list", () => listNotifications())
  ipcMain.handle("notifications:push", (_e, input) => pushNotification(input))
  ipcMain.handle("notifications:mark-read", (_e, id: string) => {
    markRead(id)
    return true
  })
  ipcMain.handle("notifications:mark-all-read", () => {
    markAllRead()
    return true
  })
  ipcMain.handle("notifications:clear", (_e, id?: string) => {
    if (id) clearOneNotification(id)
    else clearAllNotifications()
    return true
  })
  ipcMain.handle("notifications:get-prefs", () => getNotifPrefs())
  ipcMain.handle("notifications:set-prefs", (_e, prefs) => setNotifPrefs(prefs))

  // ── Settings paths (5.7) ──
  ipcMain.handle("paths:list", () => ({
    userData: app.getPath("userData"),
    logs: app.getPath("logs"),
    downloads: app.getPath("downloads"),
    home: app.getPath("home"),
    cache: app.getPath("sessionData"),
    portableNode: PORTABLE_NODE_DIR,
    openagentsHome: path.join(os.homedir(), ".openagents"),
  }))
  ipcMain.handle("paths:show", (_e, p: string) => {
    try {
      shell.showItemInFolder(asPath(p, "path"))
      return true
    } catch {
      return false
    }
  })

  // Powers Settings → Runtime. Everything here is read straight from the OS on
  // demand — cheap enough to poll while that section is open, and deliberately
  // not cached so "free memory" and CPU actually move.
  ipcMain.handle("system:info", () => {
    let diskFree: number | null = null
    let diskTotal: number | null = null
    try {
      // statfs landed in Node 18.15; guard so an older runtime just omits disk.
      const statfs = (fs as unknown as { statfsSync?: (p: string) => { bsize: number; blocks: number; bavail: number } }).statfsSync
      if (statfs) {
        const st = statfs(app.getPath("userData"))
        diskFree = st.bsize * st.bavail
        diskTotal = st.bsize * st.blocks
      }
    } catch {}

    // getAppMetrics covers every helper process (renderer, GPU, utility), so
    // this is the launcher's real footprint rather than main's alone.
    let appMemory = 0
    let appCpu = 0
    try {
      for (const m of app.getAppMetrics()) {
        appMemory += (m.memory?.workingSetSize || 0) * 1024
        appCpu += m.cpu?.percentCPUUsage || 0
      }
    } catch {}

    return {
      platform: process.platform,
      osRelease: os.release(),
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model || null,
      cpuCount: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      diskFree,
      diskTotal,
      appMemory,
      appCpu,
      uptime: process.uptime(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      appVersion: getLauncherVersion(),
      locale: app.getLocale(),
      packaged: app.isPackaged,
    }
  })

  ipcMain.handle("settings:get-all", () => store.get())
  ipcMain.handle("settings:export", () => {
    return JSON.stringify(store.get(), null, 2)
  })
  // Writes through a native Save dialog so the user picks the destination and
  // a cancel is reported as such — the renderer used to trigger an <a download>
  // and claim success before any location had been chosen.
  ipcMain.handle("settings:export-to-file", async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    const stamp = new Date().toISOString().slice(0, 10)
    const opts = {
      defaultPath: `openagents-settings-${stamp}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    }
    const result = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      fs.writeFileSync(
        result.filePath,
        JSON.stringify(store.get(), null, 2),
        "utf-8",
      )
      return { ok: true, path: result.filePath }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle("settings:import", (_e, json: string) => {
    try {
      const parsed = JSON.parse(json)
      if (!parsed || typeof parsed !== "object") {
        return { ok: false, error: "Expected an object" }
      }
      for (const [k, v] of Object.entries(parsed)) {
        store.set(k, v)
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle("settings:reset", () => {
    const all = store.get() as Record<string, unknown>
    for (const k of Object.keys(all)) store.delete(k)
    return true
  })

  // Hand the user Apple's own Command Line Tools installer.
  //
  // Some agents install through a `curl … | bash` script that needs git, which
  // a mac without developer tools does not have. The install preflight now
  // refuses to start those scripts, and this is what the resulting UI offers
  // instead — the same dialog the script would have triggered, except the user
  // asked for it and knows what it is. Apple gates the tools behind this
  // dialog; there is no headless path without MDM.
  ipcMain.handle("system:install-xcode-clt", () => {
    if (process.platform !== "darwin") {
      return { ok: false, error: "Only available on macOS" }
    }
    try {
      const { spawn } = require("child_process") as typeof import("child_process")
      // Detached + unref: the dialog and the download outlive this call, which
      // returns as soon as the request is made. Progress lives in Apple's UI.
      const proc = spawn("xcode-select", ["--install"], {
        detached: true,
        stdio: "ignore",
      })
      proc.unref()
      return { ok: true }
    } catch (e: unknown) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // The running app's own version. `system:info` also carries it, but that call
  // walks the process tree and stats the disk — far too much for the release
  // notes check that runs on every startup.
  ipcMain.handle("app:version", () => getLauncherVersion())

  // See HAS_RUN_BEFORE: the release notes ask this to tell an upgrade from a
  // pre-0.9.10 build (announce what it missed) from a fresh install (announce
  // nothing).
  ipcMain.handle("app:has-run-before", () => HAS_RUN_BEFORE)

  // Settings → Data → "Clear cache". Chromium's HTTP/image cache only: it is
  // rebuildable by definition, so nothing here needs a confirmation. Storage
  // (localStorage) is deliberately NOT touched — that is the renderer's own
  // state and it has its own control next to this one.
  ipcMain.handle("app:clear-cache", async () => {
    try {
      const s = session.defaultSession
      // Measured first so the toast can say how much came back; a cache that
      // refuses to report its size still clears.
      const freed = await s.getCacheSize().catch(() => 0)
      await s.clearCache()
      return { ok: true, freed }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // GPU acceleration is a launch-time Chromium switch, so the toggle in
  // Settings → General only takes effect on a fresh process. `quit` (not
  // `exit`) so `before-quit` still stops the agents and the daemon.
  ipcMain.handle("app:relaunch", () => {
    app.relaunch()
    app.quit()
    return true
  })

  // "Test connection" behind Settings → Network. Any HTTP answer proves the
  // address resolves and something is listening — a 404 from a workspace
  // server still means the URL is right — so only transport failures fail.
  ipcMain.handle("workspace:test-endpoint", async (_e, url: string) => {
    let origin: string
    try {
      const parsed = new URL(String(url || "").trim())
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "invalid-url" }
      }
      origin = parsed.origin
    } catch {
      return { ok: false, error: "invalid-url" }
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetch(origin, { signal: ctrl.signal })
      return { ok: true, status: res.status }
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError"
      return { ok: false, error: aborted ? "timeout" : "unreachable" }
    } finally {
      clearTimeout(timer)
    }
  })

  ipcMain.handle("agents:health-check", (_e, type) => {
    if (!agentManager) return null
    try {
      return agentManager.healthCheck(type)
    } catch {
      return null
    }
  })

  // Run a fresh sign-in probe for a hosted-login agent (Cursor/Hermes) and
  // return its health. Used by the Configure dialog after the user confirms
  // they completed the terminal login, so the result reflects reality.
  ipcMain.handle("agents:login-refresh", async (_e, type) => {
    if (!agentManager) return null
    try {
      return await agentManager.refreshHostedLogin(type)
    } catch {
      return null
    }
  })

  // Drop a stale/invalid API key (e.g. CURSOR_API_KEY) so a hosted-login agent
  // uses its browser-login session instead. See clearHostedLoginApiKey.
  ipcMain.handle("agents:login-clear-key", (_e, type, agentName) => {
    if (!agentManager) return { success: false }
    try {
      agentManager.clearHostedLoginApiKey(type, agentName || undefined)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  ipcMain.handle("core:update", async () => {
    // Run bundled `node npm-cli.js` directly (no shell, argv array) so a
    // non-ASCII home path survives on Windows — the `.cmd` shim does not.
    const npm = resolveNpmInvocation()
    if (!npm) return { success: false, error: "npm runtime not found" }
    try {
      await execFileAsync(
        npm.node,
        [
          ...npm.args,
          "install",
          "--prefix",
          PORTABLE_NODE_DIR,
          `${CORE_PKG}@latest`,
          "--ignore-scripts",
        ],
        {
          timeout: 120000,
          maxBuffer: 64 * 1024 * 1024,
          env: withPathEnv(
            PORTABLE_NODE_DIR +
              (process.platform === "win32" ? ";" : ":") +
              readPathEnv(),
          ),
        },
      )
      const corePkgPath = path.join(GLOBAL_MODULES, CORE_PKG, "package.json")
      try {
        coreVersion = JSON.parse(fs.readFileSync(corePkgPath, "utf-8")).version
      } catch {}
      if (agentManager) {
        try {
          await agentManager.stopAll()
        } catch {}
        agentManager._ensureDaemon().catch(() => {})
      }
      return { success: true, version: coreVersion }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  })

  // Only ever hand web URLs to the OS. Without this guard the renderer could
  // pass `file:///…` to open arbitrary local paths, or a registered custom
  // scheme to launch another installed app — neither is something any caller
  // here needs (every call site passes an https docs/repo/release link).
  ipcMain.handle("shell:open-external", (_e, url) => openExternalSafely(url))
  // Open a terminal running `cmd`, optionally cd'd into `cwd` first. Shared by
  // the CLI-login flow (no cwd) and the per-agent "Chat" button, which opens an
  // interactive CLI session inside the agent's working folder.
  const runTerminal = (
    cmd: string,
    cwd?: string,
    agentType?: string,
    extraEnv?: Record<string, string>,
  ): void => {
    const { spawn } = require("child_process")
    // Resolve the CLI to an ABSOLUTE binary path so the terminal never depends
    // on PATH. A CLI's own installer only edits the *registry* PATH (Cursor
    // drops itself under %LOCALAPPDATA%\cursor-agent) or lands in a per-agent
    // runtime prefix — either way a freshly-spawned terminal inherits a PATH
    // that can't see it, and a bare command dies with "'x' is not recognized as
    // an internal or external command". An absolute path sidesteps it entirely.
    const resolvedCmd = agentManager
      ? agentManager.resolveLoginCommand(cmd, agentType)
      : cmd
    // The dirs the core prepends to the daemon's PATH, so child tools the CLI
    // spawns (node, git) and the fallback when abs-path resolution misses still
    // resolve without a reboot. Taken from the core rather than rebuilt here:
    // the local copy of this list was missing npm's configured global prefix,
    // among others, so a CLI installed to a custom prefix was invisible in the
    // terminal while the daemon found it fine.
    const coreBins = agentManager?.extraBinDirs() ?? []
    // One line above the command for a CLI whose sign-in isn't where the user
    // would look for it — Gemini opens straight into chat when it remembers an
    // API key, and the Google sign-in is behind its `/auth` command.
    const hint = agentType ? agentManager?.loginHintFor(agentType) || "" : ""
    if (process.platform === "win32") {
      const { execSync: exec } = require("child_process")
      const home = process.env.USERPROFILE || os.homedir()
      const portableNode = path.join(home, ".openagents", "nodejs")
      const npmBin = path.join(process.env.APPDATA || "", "npm")
      const runtimeBins: string[] = []
      try {
        const rd = path.join(home, ".openagents", "runtimes")
        for (const d of fs.readdirSync(rd, { withFileTypes: true })) {
          if (d.isDirectory())
            runtimeBins.push(path.join(rd, d.name, "node_modules", ".bin"))
        }
      } catch {}
      // Kept as a second layer under coreBins for the case the core failed to
      // load (its own install is what the launcher is often busy repairing).
      const localAppData =
        process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
      const cliBins = [
        // Cursor: native win32 installer → %LOCALAPPDATA%\cursor-agent (the
        // executables are copied to the root, not the versions\ subdir). The
        // curl|bash layout uses ~/.local\bin or ~/.cursor\bin.
        path.join(localAppData, "cursor-agent"),
        path.join(home, ".local", "bin"),
        path.join(home, ".cursor", "bin"),
        // Hermes: native (no-WSL) installer puts hermes.exe in the portable
        // venv's Scripts dir and the uv shim in %LOCALAPPDATA%\hermes\bin.
        path.join(localAppData, "hermes", "hermes-agent", "venv", "Scripts"),
        path.join(localAppData, "hermes", "bin"),
      ]
      const allBins = [
        ...coreBins,
        ...runtimeBins,
        path.join(portableNode, "node_modules", ".bin"),
        portableNode,
        npmBin,
        ...cliBins,
      ]
        .filter((d, i, all) => {
          if (!d) return false
          const first = all.findIndex((o) => o.toLowerCase() === d.toLowerCase())
          if (first !== i) return false
          try {
            return fs.existsSync(d)
          } catch {
            return false
          }
        })
        .join(";")
      // Write the PATH prefix + command into a temp .cmd and launch a window
      // that runs it. Putting the (long) PATH *inside the file* — not on an
      // inline `set PATH=<huge> && cmd` on the `start` command line — avoids the
      // cmd.exe command-line/env overflow ("Not enough memory resources") that
      // silently aborted the `set`, leaving cursor-agent unresolved. The temp
      // path is quoted so a space in the user's home dir survives.
      try {
        const lines = [
          "@echo off",
          "chcp 65001 >nul",
          `set "PATH=${allBins};%PATH%"`,
          ...Object.entries(extraEnv || {}).map(
            ([k, v]) => `set "${k}=${v}"`,
          ),
          ...(cwd ? [`cd /d "${cwd}"`] : []),
          ...(hint ? [`echo ${hint.replace(/[&<>|^]/g, " ")}`, "echo."] : []),
          resolvedCmd,
        ]
        const tmpCmd = path.join(
          os.tmpdir(),
          `openagents-login-${Date.now()}.cmd`,
        )
        // Prepend a UTF-8 BOM so cmd.exe reads the batch file as UTF-8 instead
        // of the console's OEM codepage (GBK/936 on Chinese Windows). Without it
        // a non-ASCII cwd (`cd /d "D:\重要资料"`) or home dir in PATH is decoded
        // wrong and dies with "The system cannot find the path specified." The
        // BOM + `chcp 65001` together make non-ASCII paths in the script work.
        fs.writeFileSync(tmpCmd, "﻿" + lines.join("\r\n"), "utf-8")
        exec(`start "OpenAgents Login" cmd /K "${tmpCmd}"`, {
          stdio: "ignore",
          shell: true,
          // The one place a console window IS the feature — the user signs in
          // there. Stated explicitly so the process-wide default in
          // win-console.ts leaves it alone.
          windowsHide: false,
        })
      } catch {}
    } else if (process.platform === "darwin") {
      const home = os.homedir()
      const portableNode = path.join(home, ".openagents", "nodejs")
      const portableNodeBin = path.join(portableNode, "bin")
      const runtimeBins: string[] = []
      try {
        const rd = path.join(home, ".openagents", "runtimes")
        for (const d of fs.readdirSync(rd, { withFileTypes: true })) {
          if (d.isDirectory())
            runtimeBins.push(path.join(rd, d.name, "node_modules", ".bin"))
        }
      } catch {}
      const allBins = [
        ...coreBins,
        ...runtimeBins,
        path.join(portableNode, "node_modules", ".bin"),
        portableNodeBin,
        portableNode,
        "/usr/local/bin",
      ]
        .filter((d, i, all) => !!d && all.indexOf(d) === i)
        .join(":")
      // Quote every part for the shell. The launcher's own bundle dir
      // ("/Applications/OpenAgents Launcher.app/Contents/MacOS") is on this
      // list and contains a space: unquoted, zsh read the tail as a second
      // assignment and failed with "export: not valid in this context" — and
      // worse, it kept the truncated first half, so the user's terminal lost
      // /usr/bin as well and the login command never ran at all.
      const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
      const lines = [
        `export PATH=${sq(allBins)}:"$PATH"`,
        ...Object.entries(extraEnv || {}).map(
          ([k, v]) => `export ${k}=${sq(v)}`,
        ),
        ...(cwd ? [`cd ${sq(cwd)}`] : []),
        ...(hint ? [`echo ${sq(hint)}`, "echo"] : []),
        resolvedCmd,
      ]
      // Hand the new shell a temp script to source instead of one inline
      // string: the command already carries an absolute binary path in double
      // quotes, and squeezing that through AppleScript's string escaping on
      // top of the shell's is where the quoting kept coming apart. Sourcing
      // (`.`) leaves the PATH and cwd set in the user's own shell, so the CLI
      // stays usable in that window once the sign-in returns.
      try {
        const tmpSh = path.join(
          os.tmpdir(),
          `openagents-login-${Date.now()}.sh`,
        )
        fs.writeFileSync(tmpSh, lines.join("\n") + "\n", "utf-8")
        spawn(
          "osascript",
          [
            "-e",
            `tell app "Terminal" to do script ". ${sq(tmpSh)}"`,
            "-e",
            'tell app "Terminal" to activate',
          ],
          { detached: true, stdio: "ignore" },
        )
      } catch {}
    } else {
      const terminals = ["x-terminal-emulator", "gnome-terminal", "xterm"]
      for (const term of terminals) {
        try {
          spawn(term, ["-e", resolvedCmd], {
            detached: true,
            stdio: "ignore",
            ...(cwd ? { cwd } : {}),
          })
          return
        } catch {}
      }
    }
  }

  ipcMain.handle("shell:open-terminal", (_e, cmd) =>
    runTerminal(asShellCommand(cmd, "command")),
  )

  // ── In-app CLI sign-in ──
  // Drives `<cli> login` under pipes and surfaces its browser URL / code prompt
  // in the launcher, with runTerminal above as the automatic fallback for CLIs
  // that insist on a TTY. See cli-login.ts.
  cliLogin = new CliLoginManager({
    resolveBinary: (type) => agentManager?.resolveBinary(type) ?? null,
    loginCommandFor: (type) => agentManager?.loginCommandFor(type) ?? null,
    childEnv: (extra) => agentManager?.childEnv(extra) ?? { ...process.env },
    verifyLogin: async (type) => {
      if (!agentManager) return false
      const h = (await agentManager.refreshHostedLogin(type)) as {
        logged_in?: boolean
        ready?: boolean
      } | null
      // `logged_in` distinguishes a CLI sign-in from "has an API key" for
      // dual-auth agents; pure login agents only report `ready`.
      return h?.logged_in === true || (h?.logged_in == null && !!h?.ready)
    },
    openExternal: (url) => {
      void shell.openExternal(url)
    },
    // The type is passed explicitly: the fallback terminal must resolve the
    // SAME binary the piped attempt just used, not re-guess it from the
    // command's first word.
    openTerminal: (cmd, type) => {
      // Gemini opens straight into chat when it remembers an API key, so the
      // sign-in runs in a directory of ours whose workspace settings ask for
      // the Google flow. Everything else gets the plain terminal.
      const prep = type === "gemini" ? prepareGeminiSignIn() : null
      runTerminal(cmd, prep?.cwd, type, prep?.env)
    },
    emit: (ev) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("cli-login:event", ev)
    },
  })

  ipcMain.handle(
    "cli-login:start",
    (_e, type: string, opts?: { terminal?: boolean }) => {
      if (!cliLogin) throw new Error("Login manager not ready")
      return cliLogin.start(type, opts)
    },
  )
  ipcMain.handle("cli-login:submit-code", (_e, type: string, code: string) =>
    cliLogin?.submitCode(type, String(code || "")),
  )
  ipcMain.handle("cli-login:cancel", (_e, type: string) =>
    cliLogin?.cancel(type),
  )

  // Per-agent "Chat" entry: open a terminal in the agent's working folder and
  // launch its CLI interactively. The agent's binary is resolved to an absolute
  // path via the core's installer (PATH is also injected as a fallback), and
  // the cwd is the agent's configured path or its default workspace dir.
  ipcMain.handle("shell:open-agent-terminal", (_e, rawAgentName: string) => {
    if (!agentManager) throw new Error("Agent manager not ready")
    const agentName = asName(rawAgentName, "agent name")
    const agents = agentManager.getAgents() as Array<{
      name: string
      type?: string
      path?: string
    }>
    const agent = agents.find((a) => a.name === agentName)
    if (!agent) throw new Error(`Agent '${agentName}' not found`)
    const type = agent.type || ""
    // Require a real CLI binary — API-only agents (e.g. kimi) have none and
    // can't be driven interactively from a terminal.
    const binary = agentManager.resolveBinary(type)
    if (!binary)
      throw new Error(`Agent type '${type}' has no interactive CLI to open.`)
    const cwd = agent.path || os.homedir()
    try {
      fs.mkdirSync(cwd, { recursive: true })
    } catch {}
    // Quote the binary so a space in its path survives the shell; runTerminal
    // re-resolves it through the type, which also routes a `.js` bin (an npm
    // agent with no Windows shim) through node instead of Windows Script Host.
    runTerminal(/\s/.test(binary) ? `"${binary}"` : binary, cwd, type)
  })

  ipcMain.handle("icons:get-dir", () => {
    const coreIconsDir = path.join(GLOBAL_MODULES, CORE_PKG, "icons")
    if (fs.existsSync(coreIconsDir)) return coreIconsDir
    return null
  })
  ipcMain.handle("icons:get-path", (_e, name) => {
    const slug = (name || "").toLowerCase().replace(/[^a-z0-9-]/g, "")
    const coreIcon = path.join(GLOBAL_MODULES, CORE_PKG, "icons", `${slug}.svg`)
    if (fs.existsSync(coreIcon)) return coreIcon
    return null
  })
  ipcMain.handle("debug:env", () => ({
    ComSpec: process.env.ComSpec,
    SystemRoot: process.env.SystemRoot,
    PATH: (process.env.PATH || "").slice(0, 500),
    platform: process.platform,
  }))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      return
    }
    // No window to raise — a headless first instance, or one whose window was
    // destroyed. The second instance has already given up its lock and is
    // about to exit, so doing nothing here means clicking the icon produces
    // absolutely no response: the app is running and looks unopenable.
    createWindow()
  })
}

app.whenReady().then(async () => {
  // Local control server (--control-port=N / OPENAGENTS_CONTROL_PORT): a
  // curl-able status/driving surface for remote tests and diagnostics. Started
  // FIRST, before the first-run bootstrap (portable Node download can take
  // minutes) — every dep below reads the CURRENT module state, so /status
  // answers immediately (coreReady:false, windowOpen:false) and fills in as
  // the app boots. See control-server.ts for auth and endpoint details.
  const controlPort = configuredControlPort()
  if (controlPort !== null) {
    const appStartedAt = Date.now()
    startControlServer(controlPort, {
      getStatus: () => ({
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        headless: isHeadless,
        uptimeSeconds: Math.round((Date.now() - appStartedAt) / 1000),
        windowOpen: !!mainWindow && !mainWindow.isDestroyed(),
        coreReady: !!agentManager,
        daemonPid: agentManager?.getDaemonPid() ?? null,
        node: agentManager ? agentManager.getNodeStatus() : null,
      }),
      getAgents: () => (agentManager ? agentManager.getAgents() : []),
      pair: (code) => {
        if (!agentManager) throw new Error("core not loaded yet — retry shortly")
        return agentManager.connectNode(code, {})
      },
      screenshot: async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return null
        const image = await mainWindow.webContents.capturePage()
        return image.toPNG()
      },
      window: (action) => {
        if (action === "create" || action === "show") createWindow()
        else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
        return !!mainWindow && !mainWindow.isDestroyed()
      },
      logFiles: () => ({
        startup: STARTUP_LOG,
        daemon: path.join(os.homedir(), ".openagents", "daemon.log"),
        renderer: rendererLogPath(),
      }),
    })
      .then((srv) =>
        slog(`Control server on 127.0.0.1:${srv.port} (token: ${srv.tokenFile})`),
      )
      .catch((err) =>
        slog(`Control server FAILED to start: ${(err as Error).message}`),
      )
  }

  installApplicationMenu()

  // The window frame is drawn by the OS, so the OS has to be told which way the
  // app is themed — otherwise a dark app keeps a light Windows title bar, which
  // is what it looked like. Electron turns this into DWMWA_USE_IMMERSIVE_DARK_MODE
  // on Windows and the equivalent appearance on macOS.
  //
  // Applied here, before the first window exists, and mirrored into settings.json
  // by the `theme:set-source` handler below: the renderer keeps its own copy in
  // localStorage (read synchronously, so the page never flashes the wrong theme),
  // but that is unreachable from the main process at startup. Without a
  // main-side copy the frame would open in the system theme and only correct
  // itself once the renderer booted and called in — a visible flicker on every
  // launch for anyone not on the system default.
  applyThemeSource(store.get("themeMode"))

  // Fires both when the renderer changes the mode and when the OS flips while
  // the app is on `system`. The window-controls overlay is a plate the app
  // colours itself, so unlike the old frame it does not repaint on its own.
  nativeTheme.on("updated", () => refreshTitleBarOverlay(mainWindow))

  // Apply user settings that must reach the OS / network layer on every launch
  // (the renderer only writes them to the store; the main process is what makes
  // them take effect).
  applyStartOnBoot()
  applyProxyFromSettings(store)

  // Restore the UI language before the tray is built or any startup
  // notification fires, so main's strings match the renderer from the first
  // frame instead of falling back to the OS locale until the renderer syncs.
  setMainLanguage(store.get("language"))

  // Resolve the download region BEFORE any runtime download runs. `downloadRegion`
  // ('auto' | 'global' | 'cn') lets the user (Settings → Network) or support/QA
  // pin the origin; default 'auto' detects mainland China by timezone/locale and
  // routes Node/npm/core through the npmmirror mirror (with the official origin
  // as fallback). Also point npm's own registry at the mirror so agent installs
  // the core/daemon spawn go fast too.
  applyDownloadRegion(store.get("downloadRegion"))
  // Measure which npm registry actually answers, in the background: it only
  // has to be settled before the first agent install, which is minutes away
  // behind onboarding, and awaiting it here would delay the splash for nothing.
  const registryTuning = tuneNpmRegistry(store, CORE_PKG).catch((e: unknown) => {
    slog(`npm registry probe failed: ${(e as Error).message}`)
  })

  setupIPC()
  setupAutoUpdater({
    getWindow: () => mainWindow,
    log: slog,
    // "Automatic updates" ON (default) = background checks auto-download, and
    // electron-updater installs on the next quit. OFF = still check and still
    // notify, but wait for the user to press Download.
    isAutoUpdateEnabled: () => store.get("autoUpdate") !== false,
    // Optional mirror of the release feed, for networks where the default
    // origin is slow (mainland China without a proxy). Blank = packaged origin.
    feedUrlOverride: store.get("updateFeedUrl"),
    // Stop chat polling + the daemon/agent subprocesses before the installer
    // runs. On Windows a live daemon holds locks under the install dir, so the
    // NSIS overwrite silently fails and the relaunch comes back on the old
    // version. before-quit also calls stopAll, but that fires without being
    // awaited during quit — here we await it so teardown completes first.
    beforeInstall: async () => {
      try {
        if (agentManager) agentManager.stopAllChatPolling()
      } catch {}
      try {
        if (agentManager) await agentManager.stopAll()
      } catch {}
    },
    // beforeInstall already stopped the daemon by the time a handoff can fail.
    // Without this the user is left in a running app with every agent offline
    // and no way back short of a manual restart.
    resumeAfterFailedInstall: async () => {
      try {
        if (agentManager) await agentManager._ensureDaemon()
      } catch {}
    },
    onDownloaded: (version) => {
      // A background auto-download finished. Make it discoverable: notify the
      // user and refresh the tray so "Restart to update" appears. The install
      // itself happens on the next quit, or immediately if the user restarts.
      // Guard against duplicate notifications: electron-updater re-emits
      // update-downloaded from cache on every subsequent check once a package
      // is staged, so only notify once per version.
      updateTrayMenu()
      if (_lastUpdateNotifiedVersion === version) return
      _lastUpdateNotifiedVersion = version
      slog(`[updater] auto-update v${version} downloaded — ready to install`)
      try {
        // Only the newest package is installable, so retire the previous
        // version's prompt rather than stacking a second unread badge for an
        // update the user can no longer choose.
        clearNotificationsBySource("launcher-update")
        pushNotification({
          kind: "update_available",
          title: t("updateReadyTitle"),
          // "when you restart" was misleading for a tray-resident app: closing
          // the window only hides it, so the install never ran and the prompts
          // piled up. Point at the button that actually performs the install.
          body: t("updateReadyBody", { version }),
          source: "launcher-update",
          // Clicking the toast (or the entry in the notification centre) has to
          // lead somewhere that can actually install: the renderer re-shows the
          // update banner and opens Settings → Updates off this payload.
          payload: { settingsSection: "updates" },
        })
      } catch {}
    },
  })
  createTray()

  // NOTE: We deliberately do NOT wipe derived caches (agent catalog + the
  // downloaded core library) on an app upgrade. Clearing the core forced
  // ensureCoreLibrary() to re-download it on the next launch, and whenever
  // that download failed (offline, proxy/VPN, AV-blocked) the in-process
  // connector stayed null — so onboarding's first install died at the
  // "preparing the installer" step with no obvious cause. ensureCoreLibrary()
  // already self-heals a stale core (it compares the installed version against
  // npm `latest` and reinstalls when they differ), so the pre-emptive wipe was
  // pure downside. The previously-installed core keeps working across upgrades.

  // Detect a working bundled node, not just file presence. A previous
  // download interrupted by ECONNRESET leaves a corrupt node.exe at the
  // expected size — file exists, but Windows refuses to spawn it
  // ("此应用无法在你的电脑上运行"), which historically left every install,
  // update and daemon spawn broken forever. Smoke-test up front and wipe
  // anything that fails so the install path re-runs.
  const bundledNodePath =
    process.platform === "win32"
      ? path.join(PORTABLE_NODE_DIR, "node.exe")
      : path.join(PORTABLE_NODE_DIR, "node")
  const altUnixNode = path.join(PORTABLE_NODE_DIR, "bin", "node")
  let nodeExists = false
  if (fs.existsSync(bundledNodePath)) {
    if (canExecuteNodeBinary(bundledNodePath)) {
      nodeExists = true
    } else {
      slog(
        `bundled node at ${bundledNodePath} failed smoke test — wiping for re-download`,
      )
      try {
        fs.rmSync(PORTABLE_NODE_DIR, { recursive: true, force: true })
      } catch {}
    }
  } else if (process.platform !== "win32" && fs.existsSync(altUnixNode)) {
    nodeExists = canExecuteNodeBinary(altUnixNode)
    if (!nodeExists) {
      slog(
        `bundled node at ${altUnixNode} failed smoke test — wiping for re-download`,
      )
      try {
        fs.rmSync(PORTABLE_NODE_DIR, { recursive: true, force: true })
      } catch {}
    }
  }

  let splash: BrowserWindow | null = null

  if (isHeadless && process.platform === "darwin" && app.dock) app.dock.hide()

  if (!isHeadless) {
    const c = splashPalette({
      accent: store.get("accent"),
      skin: store.get("skin"),
    })
    splash = new BrowserWindow({
      width: 420,
      height: 260,
      frame: false,
      resizable: false,
      center: true,
      alwaysOnTop: true,
      transparent: false,
      skipTaskbar: true,
      // Painted before the document loads. Without it a dark-themed app opens
      // on a white rectangle for a frame or two, which is the flash the window
      // background exists to prevent.
      backgroundColor: c.bg,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    // Written as plain HTML and encoded on the way out. Hand-escaping `#` as
    // `%23` and `%` as `%25` inside a `data:` literal is how the bar ended up
    // stuck on a colour nothing else in the app uses.
    const splashHtml = `
      <html><body style="margin:0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:${c.bg};color:${c.title};">
        <div style="font-size:28px;font-weight:700;margin-bottom:8px;">OpenAgents Launcher</div>
        <div id="msg" style="font-size:14px;color:${c.msg};margin-bottom:20px;">${!nodeExists ? "Preparing first launch..." : "Starting..."}</div>
        <div style="width:240px;height:6px;background:${c.track};border-radius:3px;overflow:hidden;">
          <div id="bar" style="width:10%;height:100%;background:${c.accent};border-radius:3px;transition:width 0.5s;"></div>
        </div>
        <div id="detail" style="font-size:11px;color:${c.detail};margin-top:8px;"></div>
      </body></html>`
    splash.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(splashHtml),
    )
    splash.show()
  }

  const updateSplash = (msg: string, pct: number, detail?: string): void => {
    if (splash && !splash.isDestroyed()) {
      splash.webContents
        .executeJavaScript(
          `
        document.getElementById('msg').textContent='${msg.replace(/'/g, "\\'")}';
        document.getElementById('bar').style.width='${pct}%';
        document.getElementById('detail').textContent='${(detail || "").replace(/'/g, "\\'")}';
      `,
        )
        .catch(() => {})
    }
  }

  if (!nodeExists) {
    slog("Node.js not found — starting download")
    updateSplash("Downloading Node.js runtime...", 20, "This only happens once")
    try {
      await downloadNodejs(PORTABLE_NODE_DIR, (pct, detail) => {
        updateSplash("Downloading Node.js...", 20 + pct * 0.5, detail)
      })
      updateSplash("Node.js installed", 70)
    } catch (e: unknown) {
      slog(`Node.js install FAILED: ${(e as Error).message}`)
      updateSplash(
        "Setup failed: " + (e as Error).message,
        50,
        "Check ~/.openagents/startup.log",
      )
      await new Promise((r) => setTimeout(r, 5000))
    }
  } else {
    updateSplash("Starting...", 50)
  }

  const npmCliPath = path.join(
    PORTABLE_NODE_DIR,
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  )
  if (!fs.existsSync(npmCliPath)) {
    slog("npm not found — installing...")
    updateSplash("Installing npm...", 55)
    try {
      const npmVersion = "10.9.8"
      const npmTgz = path.join(os.tmpdir(), `npm-${npmVersion}.tgz`)
      const npmModDir = path.join(PORTABLE_NODE_DIR, "node_modules", "npm")
      await downloadToFile(npmUrls(`npm/-/npm-${npmVersion}.tgz`), npmTgz, {
        onProgress: (pct, detail) =>
          updateSplash("Installing npm...", 55 + pct * 0.05, detail),
        log: slog,
      })
      fs.mkdirSync(npmModDir, { recursive: true })
      extractTarball(npmTgz, npmModDir)
      try {
        fs.unlinkSync(npmTgz)
      } catch {}
      if (process.platform === "win32") {
        // %~dp0-relative so cmd.exe (which reads this .cmd file with the OEM
        // code page) never sees an embedded non-ASCII path. See the matching
        // shim in downloadNodejs().
        fs.writeFileSync(
          path.join(PORTABLE_NODE_DIR, "npm.cmd"),
          `@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\npm-cli.js" %*\r\n`,
        )
      }
      slog("npm installed")
    } catch (e: unknown) {
      slog("npm install failed: " + (e as Error).message)
    }
  }

  updateSplash("Checking for updates...", 60)
  _updateSplash = updateSplash

  // Prepend the bundled portable runtime to PATH so child processes
  // (npm install, daemon spawn, etc) resolve `node` / `npm` to OUR copies,
  // not to whatever the user happens to have first on PATH.
  //
  // Critical on Windows: nvm-for-windows ships a bare Unix shebang script
  // named `npm` (no extension) alongside `npm.cmd`. If `where npm` returns
  // the Unix script first, cmd.exe refuses to run it ("is not recognized
  // as an internal or external command") — breaks every install. The
  // bundled prefix only contains `npm.cmd`, so forcing PORTABLE_NODE_DIR
  // to the front gets us a runnable shim.
  //
  // Use read/writePathEnv so we update Windows' canonical `Path` key in
  // place rather than creating a parallel `PATH` key that the spawn env
  // spread can leak to children inconsistently.
  if (process.platform === "win32") {
    const currentPath = readPathEnv()
    const pathDirs = currentPath.toLowerCase().split(";")
    const candidates = [
      PORTABLE_NODE_DIR,
      path.join(process.env.APPDATA || "", "npm"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "nodejs"),
    ].filter((d) => {
      try {
        return d && fs.existsSync(d) && !pathDirs.includes(d.toLowerCase())
      } catch {
        return false
      }
    })
    if (candidates.length) {
      writePathEnv(candidates.join(";") + ";" + currentPath)
    }
  } else {
    const binDir = path.join(PORTABLE_NODE_DIR, "bin")
    const currentPath = readPathEnv()
    if (fs.existsSync(binDir) && !currentPath.includes(binDir)) {
      writePathEnv(binDir + ":" + currentPath)
    }
  }

  // The core install's npm fallback path shells out to npm, so let the probe
  // land first — by now it has almost certainly already finished.
  await registryTuning
  await ensureCoreLibrary()

  if (
    fs.existsSync(GLOBAL_MODULES) &&
    !require("module").globalPaths.includes(GLOBAL_MODULES)
  ) {
    require("module").globalPaths.push(GLOBAL_MODULES)
  }

  if (splash && !splash.isDestroyed()) {
    splash.webContents
      .executeJavaScript(
        `
      document.getElementById('msg').textContent='Ready!';
      document.getElementById('bar').style.width='100%';
    `,
      )
      .catch(() => {})
    await new Promise((r) => setTimeout(r, 500))
    splash.close()
    splash = null
  }

  // Create the main window BEFORE loading the connector. AgentManager's
  // constructor performs a synchronous `require()` of the agent-launcher
  // core, which on Windows can take 1-2s while Defender scans the freshly
  // extracted files. Doing it after the BrowserWindow exists lets the
  // renderer load in parallel — the user sees the UI instead of a frozen
  // post-splash desktop. IPC handlers safely return defaults while
  // agentManager is still undefined; the onboarding catalog poll retries
  // until it lands.
  if (!isHeadless) createWindow()
  // Past this line the user has something to look at, so later failures are
  // logged rather than fatal. Headless runs count too: they are supposed to
  // have no window.
  markUiReached()

  agentManager = new AgentManager(store)
  agentManager!
    ._ensureDaemon()
    // Settings → Agents "start agents on launch". Chained onto the daemon so
    // the core is actually loaded before we ask it to start anything; a failure
    // here is non-fatal, the user can still start each agent by hand.
    .then(() => {
      if (store.get("agentAutoStart") !== true) return
      slog("agentAutoStart is on — starting all configured agents")
      return agentManager?.startAll()
    })
    .catch(() => {})

  agentManager.on("chat-event", (ev: ChatStreamEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("chat:event", ev)
    }
  })

  setInterval(() => updateTrayMenu(), 5000)

  const FOUR_HOURS = 4 * 60 * 60 * 1000
  const ONE_HOUR = 60 * 60 * 1000
  setInterval(() => checkCoreUpdate().catch(() => {}), FOUR_HOURS)
  setTimeout(() => checkCoreUpdate().catch(() => {}), 30000)

  // Launcher self-update: check shortly after launch and every half hour
  // thereafter. Surfaces a banner in the renderer; whether the download starts
  // by itself depends on the "Automatic updates" setting, which
  // checkForUpdatesOnStartup reads to set autoDownload.
  //
  // Note we no longer skip the *check* when that setting is off. It used to
  // return early, which meant turning off automatic updates also turned off
  // ever being told a new version exists — the user just silently stayed on an
  // old build. Off now means "don't download it for me", not "don't tell me".
  const THIRTY_MIN = 30 * 60 * 1000
  let _lastLauncherUpdateCheck = 0
  const launcherUpdateCheck = (minGapMs = 0): void => {
    const now = Date.now()
    if (minGapMs > 0 && now - _lastLauncherUpdateCheck < minGapMs) return
    _lastLauncherUpdateCheck = now
    void checkForUpdatesOnStartup().then((ok) => {
      // A check that never completed shouldn't hold the throttle window: the
      // next foreground event should be free to retry immediately rather than
      // waiting the gap out on the strength of a failure.
      if (!ok) _lastLauncherUpdateCheck = 0
    })
  }

  // The first check retries with a backoff instead of firing once and giving
  // up. On a fresh install the 20s mark lands in the middle of the first-run
  // Node/core downloads and — for users who bring up a VPN right after
  // installing — often before the tunnel is. One silent failure there used to
  // mean no update prompt at all for the next half hour, which reads as "the
  // launcher never noticed the new version".
  const STARTUP_CHECK_DELAYS = [20_000, 60_000, 180_000, 600_000]
  const runStartupCheck = async (attempt = 0): Promise<void> => {
    const ok = await checkForUpdatesOnStartup().catch(() => false)
    if (ok) {
      _lastLauncherUpdateCheck = Date.now()
      return
    }
    const next = attempt + 1
    if (next < STARTUP_CHECK_DELAYS.length) {
      setTimeout(() => void runStartupCheck(next), STARTUP_CHECK_DELAYS[next])
    }
  }
  setTimeout(() => void runStartupCheck(), STARTUP_CHECK_DELAYS[0])
  // Every 30 min (was every 4h — too long for a tray-resident app to ever
  // surface a fresh release while it stays open).
  setInterval(() => launcherUpdateCheck(), THIRTY_MIN)
  // Also check whenever the user brings the window back to the foreground, so a
  // release published while they had it in the tray is discovered the moment
  // they look, not up to half an hour later. Throttled to at most once per 10 min.
  const onWindowForeground = (): void => launcherUpdateCheck(10 * 60 * 1000)
  app.on("browser-window-focus", onWindowForeground)

  setTimeout(() => refreshAgentUpdates(), 45000)
  setInterval(() => refreshAgentUpdates(), ONE_HOUR)
}).catch(reportStartupError)

app.on("window-all-closed", () => {
  /* keep running in tray */
})

app.on("activate", () => {
  if (!isHeadless) createWindow()
})

app.on("before-quit", () => {
  ;(app as typeof app & { isQuitting: boolean }).isQuitting = true
  try {
    cliLogin?.disposeAll()
  } catch {}
  try {
    if (agentManager) agentManager.stopAllChatPolling()
  } catch {}
  try {
    if (agentManager) agentManager.stopAll()
  } catch {}
})
