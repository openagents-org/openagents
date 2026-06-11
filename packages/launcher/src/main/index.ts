import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  shell,
} from "electron"
import path from "path"
import fs from "fs"
import os from "os"
import crypto from "crypto"
import { pipeline } from "stream/promises"
import { Transform } from "stream"
import { execSync, execFile, spawnSync } from "child_process"
import { Store } from "./store"
import { readPathEnv, writePathEnv, withPathEnv } from "./env"
import { AgentManager, type ChatStreamEvent } from "./agent-manager"
import {
  ConnectionsStore,
  CredentialsStore,
  type ConnectionRecord,
} from "./connections-store"
import { probe as probeConnection } from "./connection-tester"
import { getGitHubClient, parseGitHubRepo } from "./github-bridge"
import { GitHubBindingsStore } from "./github-bindings-store"
import {
  setNotificationsWindow,
  pushNotification,
  listNotifications,
  markRead,
  markAllRead,
  clearAll as clearAllNotifications,
  clearOne as clearOneNotification,
  getPrefs as getNotifPrefs,
  setPrefs as setNotifPrefs,
} from "./notifications"

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
      },
      (err, stdout) => {
        if (err) reject(err)
        else resolve((stdout || "").toString().trim())
      },
    )
  })
}

/**
 * Belt-and-braces guard for the install pipeline. The agent-launcher core
 * resolves `npm` via `whichBinary('npm')` → first line of `where npm`.
 *
 * On Windows with nvm-for-windows installed, `C:\nvm4w\nodejs\` contains both
 *   - `npm`      (Unix shebang script, no extension)
 *   - `npm.cmd`  (Windows batch shim)
 *
 * `where` lists the bare `npm` first, so cmd.exe ends up trying to run a Unix
 * script and dies with "is not recognized as an internal or external command"
 * — breaking every agent install. The bundled portable runtime only ships
 * `npm.cmd`, so forcing PORTABLE_NODE_DIR to the very front of PATH makes
 * `where npm` return our `npm.cmd` first instead.
 *
 * Idempotent: if PORTABLE_NODE_DIR is already first, this is a no-op.
 */
function ensureBundledRuntimeFirstOnPath(): void {
  if (process.platform !== "win32") return
  if (!fs.existsSync(PORTABLE_NODE_DIR)) return
  const sep = ";"
  const target = PORTABLE_NODE_DIR.toLowerCase()
  const parts = readPathEnv().split(sep)
  if (parts.length > 0 && parts[0].toLowerCase() === target) return
  const filtered = parts.filter((p) => p.toLowerCase() !== target)
  writePathEnv([PORTABLE_NODE_DIR, ...filtered].join(sep))
}

// Smoke-test a node binary. Returns true only if `--version` exits cleanly.
// Used at startup to detect a corrupt bundled node.exe (e.g. from an
// interrupted download) that Windows would refuse to spawn with
// "此应用无法在你的电脑上运行".
function canExecuteNodeBinary(binaryPath: string): boolean {
  try {
    const r = spawnSync(binaryPath, ["--version"], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return r.status === 0 && !r.error
  } catch {
    return false
  }
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

const isHeadless = process.argv.includes("--headless")
if (process.argv.includes("--disable-gpu") || isHeadless) {
  app.disableHardwareAcceleration()
}

const PORTABLE_NODE_DIR = path.join(os.homedir(), ".openagents", "nodejs")
const GLOBAL_MODULES = path.join(PORTABLE_NODE_DIR, "node_modules")
const CORE_PKG = "@openagents-org/agent-launcher"

if (
  fs.existsSync(GLOBAL_MODULES) &&
  !require("module").globalPaths.includes(GLOBAL_MODULES)
) {
  require("module").globalPaths.push(GLOBAL_MODULES)
}

const store = new Store()
const connectionsStore = new ConnectionsStore()
const credentialsStore = new CredentialsStore()
const githubBindingsStore = new GitHubBindingsStore()
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let agentManager: AgentManager | null = null
let coreVersion: string | null = null

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

const STARTUP_LOG = path.join(os.homedir(), ".openagents", "startup.log")
function slog(msg: string): void {
  try {
    fs.mkdirSync(path.dirname(STARTUP_LOG), { recursive: true })
    fs.appendFileSync(STARTUP_LOG, `${new Date().toISOString()} ${msg}\n`)
  } catch {}
  console.log("[startup]", msg)
}

// Atomic download with backpressure and on-error cleanup.
// Writes to `${destPath}.part`, then renames on success. On any error
// (HTTP error, ECONNRESET mid-stream, write failure) the partial is
// deleted so the next launch doesn't see a corrupt file at the final path.
async function downloadFile(
  https: typeof import("https"),
  url: string,
  destPath: string,
  onProgress: ((pct: number, detail: string) => void) | null,
): Promise<void> {
  const tmpPath = destPath + ".part"
  try {
    fs.unlinkSync(tmpPath)
  } catch {}

  const resolveResponse = (
    u: string,
    hops = 0,
  ): Promise<import("http").IncomingMessage> =>
    new Promise((resolve, reject) => {
      if (hops > 5) {
        reject(new Error("Too many redirects"))
        return
      }
      const req = https.get(u, (res) => {
        const status = res.statusCode || 0
        if (
          (status === 301 ||
            status === 302 ||
            status === 307 ||
            status === 308) &&
          res.headers.location
        ) {
          res.resume()
          resolveResponse(res.headers.location, hops + 1).then(resolve, reject)
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error(`HTTP ${status} for ${u}`))
          return
        }
        resolve(res)
      })
      req.on("error", reject)
      req.setTimeout(60_000, () =>
        req.destroy(new Error(`Request timed out: ${u}`)),
      )
    })

  try {
    const res = await resolveResponse(url)
    const total = parseInt(res.headers["content-length"] || "0", 10) || 0
    let downloaded = 0
    if (onProgress) {
      res.on("data", (chunk: Buffer) => {
        downloaded += chunk.length
        if (total)
          onProgress(
            Math.round((downloaded / total) * 100),
            `${(downloaded / 1e6).toFixed(1)} MB`,
          )
      })
    }
    // pipeline() respects backpressure and rejects on any error from either
    // stream, including mid-download ECONNRESET — exactly the failure mode
    // that left a corrupt node.exe on disk in the original implementation.
    await pipeline(res, fs.createWriteStream(tmpPath))
    if (total && downloaded !== total) {
      throw new Error(`Short read: got ${downloaded} of ${total} bytes`)
    }
    fs.renameSync(tmpPath, destPath)
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath)
    } catch {}
    throw err
  }
}

function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const stream = fs.createReadStream(filePath)
    stream.on("data", (c) => hash.update(c))
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()))
    stream.on("error", reject)
  })
}

async function fetchNodeShasum(
  https: typeof import("https"),
  nodeVersion: string,
  relativePath: string,
): Promise<string | null> {
  const url = `https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`
  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          resolve(null)
          return
        }
        let body = ""
        res.setEncoding("utf-8")
        res.on("data", (c) => {
          body += c
        })
        res.on("end", () => {
          for (const line of body.split(/\r?\n/)) {
            const [sum, file] = line.trim().split(/\s+/)
            if (file === relativePath && sum) {
              resolve(sum.toLowerCase())
              return
            }
          }
          resolve(null)
        })
        res.on("error", () => resolve(null))
      })
      .on("error", () => resolve(null))
  })
}

// Map process.arch to Node.js distribution arch. Falls back to x64 — Windows
// ia32 is not produced for v22+ and Node.js does not publish 32-bit Windows
// binaries anymore.
function nodeDistArch(): string {
  if (process.arch === "arm64") return "arm64"
  return "x64"
}

async function downloadAndVerify(
  https: typeof import("https"),
  url: string,
  destPath: string,
  expectedSha: string | null,
  onProgress: ((pct: number, detail: string) => void) | null,
): Promise<void> {
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await downloadFile(https, url, destPath, onProgress)
      if (expectedSha) {
        const actual = await sha256OfFile(destPath)
        if (actual !== expectedSha) {
          try {
            fs.unlinkSync(destPath)
          } catch {}
          throw new Error(
            `SHA256 mismatch for ${path.basename(destPath)}: expected ${expectedSha.slice(0, 12)}…, got ${actual.slice(0, 12)}…`,
          )
        }
      }
      return
    } catch (e: unknown) {
      lastErr = e as Error
      slog(`download attempt ${attempt} failed for ${url}: ${lastErr.message}`)
    }
  }
  throw lastErr || new Error("download failed")
}

async function downloadNodejs(
  nodejsDir: string,
  onProgress: (pct: number, detail: string) => void,
): Promise<void> {
  const https = require("https")
  const nodeVersion = "v22.22.3"
  const arch = nodeDistArch()

  try {
    fs.rmSync(nodejsDir, { recursive: true, force: true })
  } catch {}
  fs.mkdirSync(nodejsDir, { recursive: true })
  slog(
    `downloadNodejs: platform=${process.platform} arch=${arch} dir=${nodejsDir}`,
  )

  if (process.platform === "win32") {
    const nodeRelative = `win-${arch}/node.exe`
    const nodeExeUrl = `https://nodejs.org/dist/${nodeVersion}/${nodeRelative}`
    const nodeExeDest = path.join(nodejsDir, "node.exe")
    const expectedSha = await fetchNodeShasum(https, nodeVersion, nodeRelative)
    if (!expectedSha)
      slog(`SHASUMS256.txt unavailable — proceeding without hash verification`)
    await downloadAndVerify(
      https,
      nodeExeUrl,
      nodeExeDest,
      expectedSha,
      onProgress,
    )
    if (!canExecuteNodeBinary(nodeExeDest)) {
      try {
        fs.unlinkSync(nodeExeDest)
      } catch {}
      throw new Error(
        "Bundled node.exe failed smoke test (--version did not exit cleanly). The download may be corrupt or blocked by security software.",
      )
    }

    const npmVersion = "10.9.8"
    const npmUrl = `https://registry.npmjs.org/npm/-/npm-${npmVersion}.tgz`
    const npmTgz = path.join(os.tmpdir(), `npm-${npmVersion}.tgz`)
    const npmModDir = path.join(nodejsDir, "node_modules", "npm")
    if (onProgress) onProgress(85, "Installing npm...")
    await downloadAndVerify(https, npmUrl, npmTgz, null, null)

    fs.mkdirSync(npmModDir, { recursive: true })
    try {
      execSync(`tar -xzf "${npmTgz}" -C "${npmModDir}" --strip-components=1`, {
        timeout: 60000,
        stdio: "pipe",
      })
    } catch (e: unknown) {
      slog(`npm extraction failed: ${(e as Error).message}`)
    }
    try {
      fs.unlinkSync(npmTgz)
    } catch {}

    const npmCliPath = path.join(npmModDir, "bin", "npm-cli.js")
    if (fs.existsSync(npmCliPath)) {
      // Reference node.exe / the cli via %~dp0 (this .cmd file's own dir),
      // NOT an absolute path. cmd.exe reads a .cmd FILE from disk using the OEM
      // code page (936/GBK on zh-CN), so an embedded "C:\Users\中文名\…" path
      // would be corrupted; %~dp0 is resolved from the filesystem at runtime as
      // Unicode and stays correct under a non-ASCII home dir.
      fs.writeFileSync(
        path.join(nodejsDir, "npm.cmd"),
        `@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\npm-cli.js" %*\r\n`,
      )
      fs.writeFileSync(
        path.join(nodejsDir, "npx.cmd"),
        `@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\npx-cli.js" %*\r\n`,
      )
    }
  } else {
    const platName = process.platform === "darwin" ? "darwin" : "linux"
    const ext = process.platform === "darwin" ? "tar.gz" : "tar.xz"
    const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-${platName}-${arch}.${ext}`
    const tarPath = path.join(os.tmpdir(), `node-${nodeVersion}.${ext}`)

    await downloadFile(https, url, tarPath, onProgress)
    if (onProgress) onProgress(90, "Extracting...")
    const flag = ext === "tar.gz" ? "-xzf" : "-xJf"
    execSync(
      `tar ${flag} "${tarPath}" -C "${nodejsDir}" --strip-components=1`,
      { timeout: 120000 },
    )
    try {
      fs.unlinkSync(tarPath)
    } catch {}

    const binDir = path.join(nodejsDir, "bin")
    for (const name of ["node", "npm", "npx"]) {
      const src = path.join(binDir, name)
      const dest = path.join(nodejsDir, name)
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try {
          fs.symlinkSync(src, dest)
        } catch {}
      }
    }
  }
  if (onProgress) onProgress(100, "Done")
}

function findNpmCommand(): string | null {
  const nodeUnified = path.join(
    PORTABLE_NODE_DIR,
    process.platform === "win32" ? "node.exe" : "node",
  )
  const nodeBin = fs.existsSync(nodeUnified)
    ? nodeUnified
    : path.join(PORTABLE_NODE_DIR, "bin", "node")
  if (!fs.existsSync(nodeBin)) return null
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
  if (npmCli) return `"${nodeBin}" "${npmCli}"`
  if (process.platform !== "win32") {
    const npmBin = path.join(PORTABLE_NODE_DIR, "bin", "npm")
    if (fs.existsSync(npmBin)) return `"${npmBin}"`
  }
  return null
}

function _addToPrefixPackageJson(pkg: string, version: string): void {
  const pkgJsonPath = path.join(PORTABLE_NODE_DIR, "package.json")
  let data: { dependencies?: Record<string, string> } = {}
  try {
    data = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"))
  } catch {}
  if (!data.dependencies) data.dependencies = {}
  data.dependencies[pkg] = version
  try {
    fs.writeFileSync(pkgJsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8")
  } catch {}
}

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

  const https = require("https")
  try {
    const latestVersion: string = await new Promise((res, rej) => {
      https
        .get(
          `https://registry.npmjs.org/${CORE_PKG}/latest`,
          (r: import("http").IncomingMessage) => {
            let d = ""
            r.on("data", (c: Buffer) => (d += c))
            r.on("end", () => {
              try {
                res(JSON.parse(d).version)
              } catch {
                rej(new Error("parse error"))
              }
            })
          },
        )
        .on("error", rej)
    })

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
      const tgzUrl = `https://registry.npmjs.org/${CORE_PKG}/-/agent-launcher-${latestVersion}.tgz`
      const tgzPath = path.join(
        os.tmpdir(),
        `agent-launcher-${latestVersion}.tgz`,
      )
      const destDir = path.join(GLOBAL_MODULES, CORE_PKG)

      await downloadFile(https, tgzUrl, tgzPath, null)
      try {
        fs.rmSync(destDir, { recursive: true, force: true })
      } catch {}
      fs.mkdirSync(destDir, { recursive: true })
      execSync(`tar -xzf "${tgzPath}" -C "${destDir}" --strip-components=1`, {
        timeout: 60000,
        stdio: "pipe",
      })
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
        _addToPrefixPackageJson(CORE_PKG, newVersion)
      }
    }
  } catch (e: unknown) {
    slog("Core update failed: " + (e as Error).message)
    if (!installedVersion) {
      slog("Falling back to npm...")
      const npmCmd = findNpmCommand()
      if (npmCmd) {
        try {
          execSync(
            `${npmCmd} install --prefix "${PORTABLE_NODE_DIR}" ${CORE_PKG}@latest --ignore-scripts`,
            {
              stdio: "pipe",
              timeout: 120000,
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
      await downloadFile(
        https,
        "https://registry.npmjs.org/npm/-/npm-10.9.8.tgz",
        npmTgz,
        null,
      )
      fs.mkdirSync(npmDir, { recursive: true })
      execSync(`tar -xzf "${npmTgz}" -C "${npmDir}" --strip-components=1`, {
        timeout: 60000,
        stdio: "pipe",
      })
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
    const latest = execSync(`${npmCmd} view ${CORE_PKG} version`, {
      encoding: "utf-8",
      timeout: 15000,
      env: withPathEnv(
        PORTABLE_NODE_DIR +
          (process.platform === "win32" ? ";" : ":") +
          readPathEnv(),
      ),
    }).trim()

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
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: "OpenAgents Launcher",
    autoHideMenuBar: true,
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

  // Keyboard shortcuts to toggle DevTools manually in dev (F12 / Cmd+Opt+I /
  // Ctrl+Shift+I). Disabled in packaged builds.
  if (!app.isPackaged) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return
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
  }

  mainWindow.on("close", (e) => {
    if (!(app as typeof app & { isQuitting?: boolean }).isQuitting) {
      e.preventDefault()
      mainWindow!.hide()
      if (process.platform === "darwin" && app.dock) app.dock.hide()
    }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

function createPlaceholderIcon(): Electron.NativeImage {
  const size = 16
  const canvas = Buffer.alloc(size * size * 4)
  const cx = 7.5,
    cy = 7.5,
    r = 7,
    ri = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      if (d <= r) {
        if (d <= ri) {
          canvas[i] = 0xff
          canvas[i + 1] = 0xff
          canvas[i + 2] = 0xff
          canvas[i + 3] = 0xff
        } else {
          canvas[i] = 0x6c
          canvas[i + 1] = 0x63
          canvas[i + 2] = 0xff
          canvas[i + 3] = 0xff
        }
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size })
}

function createTray(): void {
  const assetsDir = path.join(__dirname, "../../assets")
  let trayIcon: Electron.NativeImage

  if (process.platform === "darwin") {
    trayIcon = nativeImage.createFromPath(
      path.join(assetsDir, "tray-iconTemplate.png"),
    )
  } else {
    trayIcon = nativeImage.createFromPath(path.join(assetsDir, "tray-icon.png"))
  }

  if (!trayIcon || trayIcon.isEmpty()) trayIcon = createPlaceholderIcon()

  tray = new Tray(trayIcon)
  tray.setToolTip("OpenAgents Launcher")
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
      : [{ label: "No agents configured", enabled: false }]

  const updateItems: Electron.MenuItemConstructorOptions[] =
    _pendingAgentUpdates.length > 0
      ? [
          { type: "separator" },
          {
            label: `Updates available (${_pendingAgentUpdates.length})`,
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

  const menu = Menu.buildFromTemplate([
    { label: "Open Dashboard", click: () => createWindow() },
    { type: "separator" },
    ...agentItems,
    ...updateItems,
    { type: "separator" },
    {
      label: "Quit OpenAgents",
      click: async () => {
        const { dialog } = require("electron")
        const result = await dialog.showMessageBox({
          type: "question",
          buttons: ["Quit", "Cancel"],
          defaultId: 1,
          title: "Quit OpenAgents Launcher",
          message: "Quit OpenAgents Launcher?",
          detail:
            "The daemon will stop and all connected agents will go offline.",
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
      `OpenAgents Launcher · ${_pendingAgentUpdates.length} update${_pendingAgentUpdates.length > 1 ? "s" : ""} available`,
    )
  } else {
    tray.setToolTip("OpenAgents Launcher")
  }
}

async function refreshAgentUpdates(): Promise<void> {
  if (!agentManager) return
  try {
    const all = await agentManager.checkAgentUpdates({ force: true })
    _pendingAgentUpdates = all.filter(
      (u) => u.current && u.latest && u.current !== u.latest,
    )
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("agent-updates-changed", _pendingAgentUpdates)
    }
    updateTrayMenu()
  } catch {}
}

type InstallPhase =
  | "idle"
  | "preparing"
  | "downloading"
  | "installing"
  | "verifying"
  | "done"
  | "error"
type InstallVerb = "install" | "update" | "uninstall" | "rollback"

function broadcastInstallProgress(payload: {
  agent: string
  verb: InstallVerb
  phase: InstallPhase
  detail?: string
  log?: string
  error?: string
}): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("install:progress", payload)
  }
}

function installStepLabel(phase: InstallPhase, verb: InstallVerb): string {
  if (phase === "downloading") return "downloading"
  if (phase === "verifying") return "verifying the installation"
  if (phase === "installing") {
    if (verb === "uninstall") return "removing files"
    if (verb === "rollback") return "rolling back"
    if (verb === "update") return "installing the update"
    return "running the installer"
  }
  if (phase === "preparing" || phase === "idle") return "preparing the installer"
  return "finishing the installation"
}

function userFacingInstallError(
  err: unknown,
  phase: InstallPhase,
  verb: InstallVerb,
): string {
  const raw = err instanceof Error ? err.message : String(err || "")
  const text = raw.toLowerCase()
  const step = installStepLabel(phase, verb)

  let reason = "The installer stopped before it could finish."
  let hint = "Open the log for details, then try again."

  if (
    text.includes("not recognized as an internal or external command") ||
    text.includes("not recognized") ||
    text.includes("enoent") ||
    text.includes("command not found")
  ) {
    reason = "A required command could not be started."
    hint = "Check that the required tool is installed and available, then try again."
  } else if (
    text.includes("short read") ||
    text.includes("ssl") ||
    text.includes("handshake") ||
    text.includes("network") ||
    text.includes("timeout") ||
    text.includes("econnreset") ||
    text.includes("unable to get local issuer certificate")
  ) {
    reason = "The download connection failed."
    hint = "Check your network, proxy, or VPN, then retry the install."
  } else if (
    text.includes("permission") ||
    text.includes("access is denied") ||
    text.includes("access denied") ||
    text.includes("executionpolicy")
  ) {
    reason = "The installer did not have permission to complete."
    hint = "Check system permissions and retry."
  } else if (text.includes("not found") || text.includes("not installed")) {
    reason = "The installed command could not be found."
    hint = "Open the log to see which command was missing."
  }

  return `Failed while ${step}. ${reason} ${hint}`
}

function classifyInstallChunk(
  chunk: string,
  verb: InstallVerb,
): { phase?: InstallPhase; detail?: string } {
  const line = chunk.toLowerCase()
  if (verb === "uninstall") {
    if (line.includes("removed") || line.includes("uninstall"))
      return { phase: "installing", detail: "Removing files" }
    if (line.includes("done!"))
      return { phase: "verifying", detail: "Cleaning shims" }
    return {}
  }
  if (
    line.includes("downloading") ||
    /\b\d+\s*%/.test(line) ||
    line.includes("mb")
  ) {
    return { phase: "downloading", detail: chunk.trim().slice(0, 80) }
  }
  if (line.includes("extracting") || line.includes("expanding")) {
    return { phase: "installing", detail: "Extracting archive" }
  }
  if (line.includes("npm warn") || line.includes("npm http")) {
    return { phase: "installing" }
  }
  if (line.includes("added ") && line.includes("package")) {
    return { phase: "verifying", detail: chunk.trim().slice(0, 80) }
  }
  if (line.includes("done!") || line.includes("installed.")) {
    return { phase: "verifying", detail: "Finalizing" }
  }
  return {}
}

async function runInstallWithPhases<T>(
  agent: string,
  verb: InstallVerb,
  runner: (onData: (data: string) => void) => Promise<T>,
): Promise<T> {
  let currentPhase: InstallPhase = "preparing"
  broadcastInstallProgress({
    agent,
    verb,
    phase: "preparing",
    detail: "Resolving dependencies",
  })

  const onData = (data: string): void => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("install:output", data)
    const { phase, detail } = classifyInstallChunk(data, verb)
    if (phase && phase !== currentPhase) {
      currentPhase = phase
      broadcastInstallProgress({ agent, verb, phase, detail })
    } else if (detail) {
      broadcastInstallProgress({ agent, verb, phase: currentPhase, detail })
    }
  }

  try {
    const result = await runner(onData)
    broadcastInstallProgress({ agent, verb, phase: "done", detail: "Complete" })
    return result
  } catch (e: unknown) {
    const friendlyError = userFacingInstallError(e, currentPhase, verb)
    broadcastInstallProgress({
      agent,
      verb,
      phase: "error",
      detail: friendlyError,
      error: friendlyError,
    })
    throw new Error(friendlyError)
  }
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
      const result = await runInstallWithPhases(agentType, verb, (cb) =>
        requireManager().installAgentTypeStreaming(agentType, cb),
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
      const result = await runInstallWithPhases(agentType, "uninstall", (cb) =>
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
  ipcMain.handle("agents:check-updates", async () => {
    if (!agentManager) return []
    try {
      return await agentManager.checkAgentUpdates()
    } catch {
      return []
    }
  })
  // Stage.md §2.5 — install at an arbitrary version/dist-tag. The renderer
  // uses this for update-channel switches (Beta / Nightly) and any future
  // "install specific version" flows. Shares the streaming + post-job
  // cache-refresh harness with install / uninstall / rollback.
  ipcMain.handle(
    "agents:install-at-version-streaming",
    async (_e, agentType, target) => {
      if (!agentManager)
        return { success: false, error: "Launcher initializing" }
      ensureBundledRuntimeFirstOnPath()
      const verb = agentManager.getInstalledVersion(agentType)
        ? "update"
        : "install"
      try {
        const result = await runInstallWithPhases(agentType, verb, (cb) =>
          agentManager!.installAgentTypeAtVersionStreaming(agentType, target, cb),
        )
        await refreshAgentUpdates().catch(() => {})
        return result
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle("agents:rollback", async (_e, agentType) => {
    if (!agentManager) return { success: false, error: "Launcher initializing" }
    ensureBundledRuntimeFirstOnPath()
    try {
      const result = await runInstallWithPhases(agentType, "rollback", (cb) =>
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
  ipcMain.handle("workspace:remove", (_e, slug) =>
    requireManager().removeWorkspace(slug),
  )
  ipcMain.handle("workspace:list", () =>
    agentManager ? agentManager.getNetworks() : [],
  )
  ipcMain.handle("workspace:create", (_e, name) =>
    requireManager().createWorkspace(name),
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
  ipcMain.handle("workspace:register-from-token", (_e, input) =>
    requireManager().registerWorkspaceFromToken(input),
  )

  ipcMain.handle("settings:get", (_e, key) => store.get(key))
  ipcMain.handle("settings:set", (_e, key, value) => {
    store.set(key, value)
    if (key === "workspaceEndpoint" && agentManager) {
      agentManager.reloadCore()
    }
  })

  // ── Connections ──
  ipcMain.handle("connections:list", () => connectionsStore.list())
  ipcMain.handle("connections:upsert", (_e, record) => connectionsStore.upsert(record))
  ipcMain.handle("connections:remove", (_e, id) => connectionsStore.remove(id))
  ipcMain.handle("connections:set-status", (_e, id, status, lastError) =>
    connectionsStore.setStatus(id, status, lastError),
  )
  ipcMain.handle("connections:test", async (_e, id) => {
    const conn = connectionsStore.get(id)
    if (!conn) return { ok: false, status: "error", detail: "Connection not found" }
    if (!conn.credentialId) {
      connectionsStore.setStatus(id, "unauthorized", "No credential linked")
      return { ok: false, status: "unauthorized", detail: "No credential linked" }
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
      connectionsStore.upsert({ id, platform: conn.platform, account: result.account })
    }
    credentialsStore.recordTest(conn.credentialId, result.ok, result.detail)
    return result
  })

  // ── Credentials ──
  ipcMain.handle("credentials:list", () => credentialsStore.list())
  ipcMain.handle("credentials:upsert", (_e, input) => credentialsStore.upsert(input))
  ipcMain.handle("credentials:remove", (_e, id) => {
    const removed = credentialsStore.remove(id)
    if (removed) {
      connectionsStore.unlinkCredential(id)
      githubBindingsStore.unlinkCredential(id)
    }
    return removed
  })
  ipcMain.handle("credentials:reveal", (_e, id) => credentialsStore.reveal(id))
  ipcMain.handle("credentials:test", async (_e, payload: {
    id?: string
    provider: string
    secret?: string
  }) => {
    let secret = payload.secret
    if (!secret && payload.id) secret = credentialsStore.getSecret(payload.id) || undefined
    if (!secret) return { ok: false, status: "error", detail: "No secret provided" }
    const result = await probeConnection(payload.provider, secret)
    if (payload.id) credentialsStore.recordTest(payload.id, result.ok, result.detail)
    return result
  })

  /**
   * Apply a credential to one or more agent types' .env files. Bridges the new
   * encrypted Credentials store to the legacy ~/.openagents/env/<type>.env
   * system that resolve_env already understands (stage.md §4.4 — image:
   * "src/env.js 增强"). Existing keys in the file are preserved; only the
   * requested envKey is overwritten.
   */
  ipcMain.handle(
    "credentials:apply-to-agents",
    async (_e, payload: { credentialId: string; envKey: string; agentTypes: string[] }) => {
      const { credentialId, envKey, agentTypes } = payload
      if (!credentialId || !envKey || !Array.isArray(agentTypes) || agentTypes.length === 0) {
        return { ok: false, error: "Missing credentialId / envKey / agentTypes" }
      }
      const secret = credentialsStore.getSecret(credentialId)
      if (!secret) return { ok: false, error: "Credential not found" }
      if (!agentManager) return { ok: false, error: "Agent manager not ready" }
      const written: string[] = []
      const errors: string[] = []
      for (const type of agentTypes) {
        try {
          const existing = (agentManager.getAgentEnv(type) as Record<string, string>) || {}
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
      const token = payload.secret
        || (payload.credentialId ? resolveGitHubToken(payload.credentialId) : null)
      if (!token) return { ok: false, error: "Missing GitHub token" }
      try {
        const r = await getGitHubClient().probe(token)
        return { ...r, ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    "github:parse-repo",
    (_e, input: string) => parseGitHubRepo(input),
  )

  ipcMain.handle("github:list-bindings", () => githubBindingsStore.list())

  ipcMain.handle(
    "github:bind-repo",
    async (_e, payload: { agentName: string; repo: string; credentialId: string }) => {
      const parsed = parseGitHubRepo(payload.repo)
      if (!parsed) return { ok: false, error: "Could not parse repo (use owner/name or URL)" }
      const token = resolveGitHubToken(payload.credentialId)
      if (!token) return { ok: false, error: "Credential not found" }
      try {
        await getGitHubClient().getRepo(parsed.owner, parsed.name, token)
      } catch (e) {
        return { ok: false, error: `Cannot access ${parsed.owner}/${parsed.name}: ${(e as Error).message}` }
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
      if (!token) return { ok: false, error: "Credential missing for this binding" }
      try {
        const items = await getGitHubClient().listIssues(
          binding.owner,
          binding.repo,
          { state: payload.state, perPage: payload.perPage, page: payload.page },
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
      if (!token) return { ok: false, error: "Credential missing for this binding" }
      try {
        const items = await getGitHubClient().listPullRequests(
          binding.owner,
          binding.repo,
          { state: payload.state, perPage: payload.perPage, page: payload.page },
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
      if (!token) return { ok: false, error: "Credential missing for this binding" }
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
      shell.showItemInFolder(p)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle("settings:get-all", () => store.get())
  ipcMain.handle("settings:export", () => {
    return JSON.stringify(store.get(), null, 2)
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

  ipcMain.handle("shell:open-external", (_e, url) => shell.openExternal(url))
  ipcMain.handle("shell:open-terminal", (_e, cmd) => {
    const { spawn } = require("child_process")
    // Resolve hosted-login CLIs (Cursor/Hermes) to an ABSOLUTE binary path so
    // the login terminal never depends on PATH. The Windows native installer
    // drops cursor-agent under %LOCALAPPDATA%\cursor-agent and only edits the
    // *registry* PATH — a freshly-spawned terminal inherits that stale, so a
    // bare `cursor-agent login` dies with "'cursor-agent' is not recognized as
    // an internal or external command". An absolute path sidesteps it entirely.
    const resolvedCmd = agentManager
      ? agentManager.resolveLoginCommand(cmd)
      : cmd
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
      // Mirror the dirs the core adds to its own enhanced PATH so child tools
      // the CLI spawns (and the fallback when abs-path resolution misses) still
      // resolve without a reboot. Kept as a PATH fallback only — the command
      // itself is already an absolute path via resolveLoginCommand above.
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
        ...runtimeBins,
        path.join(portableNode, "node_modules", ".bin"),
        portableNode,
        npmBin,
        ...cliBins,
      ]
        .filter((d) => {
          try {
            return !!d && fs.existsSync(d)
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
          resolvedCmd,
        ]
        const tmpCmd = path.join(
          os.tmpdir(),
          `openagents-login-${Date.now()}.cmd`,
        )
        fs.writeFileSync(tmpCmd, lines.join("\r\n"), "utf-8")
        exec(`start "OpenAgents Login" cmd /K "${tmpCmd}"`, {
          stdio: "ignore",
          shell: true,
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
        ...runtimeBins,
        path.join(portableNode, "node_modules", ".bin"),
        portableNodeBin,
        portableNode,
        "/usr/local/bin",
      ].join(":")
      const setPath = `export PATH=${allBins}:$PATH`
      const fullCmd = `${setPath} && ${resolvedCmd}`.replace(/"/g, '\\"')
      spawn(
        "osascript",
        ["-e", `tell app "Terminal" to do script "${fullCmd}"`],
        { detached: true, stdio: "ignore" },
      )
    } else {
      const terminals = ["x-terminal-emulator", "gnome-terminal", "xterm"]
      for (const term of terminals) {
        try {
          spawn(term, ["-e", resolvedCmd], { detached: true, stdio: "ignore" })
          return
        } catch {}
      }
    }
  })
  ipcMain.handle("shell:exec", (_e, cmd) => {
    const { execSync: exec } = require("child_process")
    const sh =
      process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : true
    return exec(cmd, { encoding: "utf-8", timeout: 30000, shell: sh })
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  if (process.platform !== "darwin") Menu.setApplicationMenu(null)

  setupIPC()
  createTray()

  // ── One-time upgrade migration ──
  // A big version bump can leave DERIVED caches stale enough to misbehave, so
  // on the first launch after an upgrade we clear (1) the agent catalog cache
  // and (2) the downloaded core (ensureCoreLibrary below reinstalls @latest),
  // and flag the renderer to re-run onboarding. USER DATA is never touched —
  // API keys (~/.openagents/env), agents (daemon.yaml), workspaces, chat
  // history and credentials all survive. A fresh install (no prior recorded
  // version) skips cleanup and just records the current version.
  try {
    const currentVersion = getLauncherVersion()
    const prevVersion = store.get("lastMigratedVersion") as string | undefined
    if (prevVersion && prevVersion !== currentVersion) {
      slog(
        `Upgrade ${prevVersion} → ${currentVersion}: clearing derived caches`,
      )
      try {
        fs.rmSync(
          path.join(os.homedir(), ".openagents", "agent_catalog.json"),
          { force: true },
        )
      } catch {}
      try {
        fs.rmSync(
          path.join(GLOBAL_MODULES, "@openagents-org", "agent-launcher"),
          { recursive: true, force: true },
        )
      } catch {}
      store.set("pendingOnboardingReset", true)
    }
    if (prevVersion !== currentVersion)
      store.set("lastMigratedVersion", currentVersion)
  } catch (e) {
    slog(`upgrade migration failed: ${(e as Error).message}`)
  }

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
    splash = new BrowserWindow({
      width: 420,
      height: 260,
      frame: false,
      resizable: false,
      center: true,
      alwaysOnTop: true,
      transparent: false,
      skipTaskbar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    const splashHtml = `data:text/html,
      <html><body style="margin:0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:%23f5f5f7;color:%23333;">
        <div style="font-size:28px;font-weight:700;margin-bottom:8px;">OpenAgents Launcher</div>
        <div id="msg" style="font-size:14px;color:%23888;margin-bottom:20px;">${!nodeExists ? "Preparing first launch..." : "Starting..."}</div>
        <div style="width:240px;height:6px;background:%23e0e0e0;border-radius:3px;overflow:hidden;">
          <div id="bar" style="width:10%25;height:100%25;background:%236C63FF;border-radius:3px;transition:width 0.5s;"></div>
        </div>
        <div id="detail" style="font-size:11px;color:%23aaa;margin-top:8px;"></div>
      </body></html>`
    splash.loadURL(splashHtml)
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
      const https = require("https")
      const npmVersion = "10.9.8"
      const npmTgz = path.join(os.tmpdir(), `npm-${npmVersion}.tgz`)
      const npmModDir = path.join(PORTABLE_NODE_DIR, "node_modules", "npm")
      await downloadFile(
        https,
        `https://registry.npmjs.org/npm/-/npm-${npmVersion}.tgz`,
        npmTgz,
        null,
      )
      fs.mkdirSync(npmModDir, { recursive: true })
      execSync(`tar -xzf "${npmTgz}" -C "${npmModDir}" --strip-components=1`, {
        timeout: 60000,
        stdio: "pipe",
      })
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

  agentManager = new AgentManager(store)
  agentManager!._ensureDaemon().catch(() => {})

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

  setTimeout(() => refreshAgentUpdates(), 45000)
  setInterval(() => refreshAgentUpdates(), ONE_HOUR)
})

app.on("window-all-closed", () => {
  /* keep running in tray */
})

app.on("activate", () => {
  if (!isHeadless) createWindow()
})

app.on("before-quit", () => {
  ;(app as typeof app & { isQuitting: boolean }).isQuitting = true
  try {
    if (agentManager) agentManager.stopAllChatPolling()
  } catch {}
  try {
    if (agentManager) agentManager.stopAll()
  } catch {}
})
