"use strict"

/**
 * Start (or attach to) the desktop launcher and hand back a control client.
 *
 * The app runs `--headless --control-port=0`: no window is created, and the
 * control server binds a free loopback port it writes to the startup log. Both
 * matter for the daily run — a headless app needs no desktop session (Windows
 * over SSH has none), and a random port never collides with the launcher the
 * developer already has open.
 *
 * The run gets its own HOME. `~/.openagents` (portable node, core lib, daemon
 * config, agent runtimes) and the Electron profile all hang off it, so a test
 * run never touches — or is polluted by — the real installation, and `--fresh`
 * is a single directory removal.
 */

const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")

const {
  Control,
  readToken,
  readControlPort,
  startupLogSize,
} = require("./control")
const { sleep, ensureDir } = require("./util")

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..")
const LAUNCHER_DIR = path.join(REPO_ROOT, "packages", "launcher")

/** Installed-app locations per platform, in the order a user would have them. */
function installedCandidates() {
  const home = os.homedir()
  if (process.platform === "darwin") {
    return [
      "/Applications/OpenAgents Launcher.app/Contents/MacOS/OpenAgents Launcher",
      path.join(
        home,
        "Applications/OpenAgents Launcher.app/Contents/MacOS/OpenAgents Launcher",
      ),
    ]
  }
  if (process.platform === "win32") {
    const local =
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
    const exe = "OpenAgents Launcher.exe"
    // The NSIS installer is `oneClick: false` and lets the user pick a
    // directory, so these are defaults rather than guarantees: per-user first
    // (what most people get), then per-machine, which the MSI always uses.
    return [
      path.join(local, "Programs", "OpenAgents Launcher", exe),
      path.join(local, "Programs", "openagents-launcher", exe),
      path.join(
        process.env["ProgramFiles"] || "C:\\Program Files",
        "OpenAgents Launcher",
        exe,
      ),
      path.join(
        process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
        "OpenAgents Launcher",
        exe,
      ),
    ]
  }
  return [
    "/opt/OpenAgents Launcher/openagents-launcher",
    "/usr/bin/openagents-launcher",
    path.join(home, "Applications", "OpenAgents Launcher.AppImage"),
  ]
}

/** The electron binary from the launcher's own node_modules, or null. */
function electronBinary() {
  let electron
  try {
    electron = require(path.join(LAUNCHER_DIR, "node_modules", "electron"))
  } catch {
    return null
  }
  return typeof electron === "string" && fs.existsSync(electron)
    ? electron
    : null
}

/** The electron-vite build output plus the electron binary that can run it. */
function devCandidate(mainEntry) {
  const main = mainEntry || path.join(LAUNCHER_DIR, "out", "main", "index.js")
  if (!fs.existsSync(main)) return null
  const electron = electronBinary()
  if (!electron) return null
  return { command: electron, args: [main], kind: "dev build" }
}

/**
 * What to run, in order of trust: an explicit path, then an installed app (what
 * the user actually ships), then the local build. A daily run should be testing
 * the shipped artifact, so the build is the fallback, never the default.
 */
function resolveLauncher(explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`--app ${explicit} does not exist`)
    }
    if (!explicit.endsWith(".js")) {
      return { command: explicit, args: [], kind: "installed app" }
    }
    // A build output, not an executable — it needs electron to run it, and
    // `npm install` in packages/launcher is what puts electron there.
    const dev = devCandidate(path.resolve(explicit))
    if (!dev) {
      throw new Error(
        `${explicit} needs electron to run it — run \`npm install\` in packages/launcher first`,
      )
    }
    return dev
  }
  for (const candidate of installedCandidates()) {
    if (fs.existsSync(candidate)) {
      return { command: candidate, args: [], kind: "installed app" }
    }
  }
  const dev = devCandidate()
  if (dev) return dev
  throw new Error(
    "no launcher found — install the app, run `npm run build` in packages/launcher, " +
      "or pass --app <path to the launcher binary>",
  )
}

class LauncherHandle {
  constructor({ control, child, homeDir, logPath, attached }) {
    this.control = control
    this.child = child
    this.homeDir = homeDir
    this.logPath = logPath
    this.attached = attached
  }

  /** Quit the app the way the tray menu does, so the daemon is stopped too. */
  async stop() {
    if (this.attached || !this.child) return
    await this.control.quit()
    for (let i = 0; i < 40 && this.child.exitCode === null; i++)
      await sleep(250)
    if (this.child.exitCode === null) {
      this.child.kill()
      await sleep(1_000)
      if (this.child.exitCode === null) this.child.kill("SIGKILL")
    }
  }
}

/** Attach to a launcher that is already running under the given HOME. */
async function attachLauncher({ homeDir, log }) {
  const token = readToken(homeDir)
  const port = readControlPort(homeDir)
  if (!token || !port) {
    throw new Error(
      `no running launcher found for HOME=${homeDir} — start it with ` +
        "`--control-port=0` (or drop --attach to have this script start one)",
    )
  }
  const control = new Control({ port, token, log })
  await control.status() // fails loudly if the token is stale
  return new LauncherHandle({
    control,
    child: null,
    homeDir,
    logPath: null,
    attached: true,
  })
}

async function startLauncher({ appPath, homeDir, outDir, bootTimeoutMs, log }) {
  const target = resolveLauncher(appPath)
  ensureDir(homeDir)
  const appData = ensureDir(path.join(homeDir, "AppData", "Roaming"))
  const localAppData = ensureDir(path.join(homeDir, "AppData", "Local"))
  const logPath = path.join(ensureDir(outDir), "launcher.out.log")
  const logStream = fs.createWriteStream(logPath, { flags: "a" })

  log(`launcher: ${target.command} (${target.kind})`)
  log(`profile HOME: ${homeDir}`)

  // Where this run's startup log begins. Everything already in the file is a
  // PREVIOUS run's — including its (now dead) control port.
  const logBaseline = startupLogSize(homeDir)

  const args = [...target.args, "--headless", "--control-port=0"]
  // AppImage/deb on a headless box often has no usable sandbox (no user
  // namespaces under some kernels/containers); the app would exit before the
  // control server ever starts.
  if (process.platform === "linux") args.push("--no-sandbox")

  const child = spawn(target.command, args, {
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      // Keep the runner's own Electron/npm settings out of the app's way.
      ELECTRON_RUN_AS_NODE: undefined,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.pipe(logStream)
  child.stderr.pipe(logStream)

  let exited = null
  child.on("exit", (code, signal) => {
    exited = { code, signal }
  })

  // 1. The app writes control.token and logs its port once the server is up.
  const deadline = Date.now() + bootTimeoutMs
  let token = null
  let port = null
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `launcher exited (code ${exited.code}, signal ${exited.signal}) before the ` +
          `control server started — see ${logPath}`,
      )
    }
    token = readToken(homeDir)
    port = readControlPort(homeDir, logBaseline)
    // Both have to answer before we trust them: a killed run can leave a token
    // file behind, and the app writes the token before it logs the port.
    if (token && port) {
      const probe = new Control({ port, token })
      const reachable = await probe.status().then(
        () => true,
        () => false,
      )
      if (reachable) break
    }
    token = null
    port = null
    await sleep(1_000)
  }
  if (!token || !port) {
    throw new Error(
      `control server did not come up within ${Math.round(bootTimeoutMs / 1000)}s — see ${logPath}`,
    )
  }
  log(`control server: 127.0.0.1:${port}`)

  const control = new Control({ port, token, log })
  const handle = new LauncherHandle({
    control,
    child,
    homeDir,
    logPath,
    attached: false,
  })

  // 2. On a cold profile the app downloads a portable node runtime and the core
  //    library before AgentManager exists — minutes, not seconds.
  await control.waitFor(
    async () => {
      if (exited) {
        throw new Error(
          `launcher exited (code ${exited.code}) while loading the core — see ${logPath}`,
        )
      }
      const status = await control.status()
      return status.coreReady ? status : null
    },
    {
      timeoutMs: Math.max(0, deadline - Date.now()),
      intervalMs: 5_000,
      label: "the core to finish loading (GET /status coreReady)",
    },
  )
  log("core ready")
  return handle
}

module.exports = {
  startLauncher,
  attachLauncher,
  resolveLauncher,
  REPO_ROOT,
  LAUNCHER_DIR,
}
