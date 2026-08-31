/**
 * The daemon process: is one alive, and how do we start another.
 *
 * "Alive" is deliberately more than a live PID — Windows recycles PIDs, and the
 * launcher used to report a healthy daemon as stopped whenever the pid file got
 * truncated by a race. See getLiveDaemonPid for the two-source rule.
 */
import path from "path"
import fs from "fs"
import { spawn } from "child_process"
import { withPathEnv } from "../env"
import {
  CONFIG_DIR,
  DAEMON_CMD_FILE,
  DAEMON_LOG_FILE,
  DAEMON_PID_FILE,
  DAEMON_STATUS_FILE,
  PORTABLE_NODE_DIR,
} from "./paths"
import { coreTiers, resolveWorkingNode, unpackedPath } from "./runtime"

/** Launcher-side note in the daemon's own log, so both sides share a timeline. */
export function appendDaemonLog(message: string): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.appendFileSync(
      DAEMON_LOG_FILE,
      `[${new Date().toISOString()}] launcher: ${message}\n`,
      "utf-8",
    )
  } catch {}
}

export function isPidAlive(pid: number | null): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * The PID of a daemon we can prove is running, or null (cleaning up the stale
 * pid/status/cmd files on the way out so a fresh start isn't blocked).
 *
 * `onStale` fires exactly when those files were cleared — the caller uses it to
 * drop any cached daemon status it was holding.
 */
export function getLiveDaemonPid(
  connector: Record<string, unknown> | null,
  onStale?: () => void,
): number | null {
  try {
    const getDaemonPid = connector?.getDaemonPid as
      (() => number | null) | undefined
    const pidFromFile = getDaemonPid ? getDaemonPid.call(connector) : null

    const pidFileAge = (() => {
      try {
        return Date.now() - fs.statSync(DAEMON_PID_FILE).mtimeMs
      } catch {
        return Number.POSITIVE_INFINITY
      }
    })()
    const statusInfo = (() => {
      try {
        const stat = fs.statSync(DAEMON_STATUS_FILE)
        const raw = JSON.parse(
          fs.readFileSync(DAEMON_STATUS_FILE, "utf-8"),
        ) as { pid?: number }
        return { pid: raw.pid || null, age: Date.now() - stat.mtimeMs }
      } catch {
        return { pid: null, age: Number.POSITIVE_INFINITY }
      }
    })()

    // The pid file gets truncated/empty under races (the launcher used to
    // delete it, and multiple foreground daemons clobber it), which made us
    // report a perfectly healthy daemon as "stopped". The daemon rewrites the
    // status file — including its own pid — every 5s, so treat that as an
    // equally authoritative source and fall back to it when the pid file is
    // missing or points at a dead process.
    const startupGraceMs = 15_000
    const statusFreshMs = 20_000
    const candidates: number[] = []
    if (pidFromFile) candidates.push(pidFromFile)
    if (statusInfo.pid && statusInfo.pid !== pidFromFile)
      candidates.push(statusInfo.pid)

    for (const pid of candidates) {
      // A live PID alone is not enough on Windows because stale PIDs can be
      // reused. Require either a young pid file (startup grace, before the
      // first status write) or a fresh status file written by THIS pid.
      const hasFreshMatchingStatus =
        statusInfo.pid === pid && statusInfo.age < statusFreshMs
      if (
        isPidAlive(pid) &&
        (pidFileAge < startupGraceMs || hasFreshMatchingStatus)
      ) {
        // Heal an empty/stale pid file so the daemon's own singleton guard
        // (which reads daemon.pid) keeps working and we don't spawn a second.
        if (pidFromFile !== pid) {
          try {
            fs.writeFileSync(DAEMON_PID_FILE, String(pid), "utf-8")
          } catch {}
        }
        return pid
      }
    }

    // Genuinely no live daemon — clean up so a fresh start isn't blocked.
    if (pidFromFile || statusInfo.pid) {
      appendDaemonLog(
        `removing stale daemon pid ${pidFromFile || statusInfo.pid}`,
      )
    }
    for (const file of [DAEMON_PID_FILE, DAEMON_STATUS_FILE, DAEMON_CMD_FILE]) {
      try {
        fs.unlinkSync(file)
      } catch {}
    }
    onStale?.()
    return null
  } catch {
    return null
  }
}

/**
 * Daemon liveness for the sidebar dot. `livePid` is getLiveDaemonPid's answer;
 * when it's null we still look for a just-spawned daemon (a young pid file that
 * hasn't written its first status yet) and call that "starting" rather than
 * letting the dot flicker offline → online.
 */
export function readDaemonState(livePid: number | null): {
  state: "online" | "starting" | "offline"
  pid: number | null
} {
  if (livePid) return { state: "online", pid: livePid }
  try {
    const raw = fs.readFileSync(DAEMON_PID_FILE, "utf-8").trim()
    const candidatePid = parseInt(raw, 10)
    if (Number.isFinite(candidatePid) && isPidAlive(candidatePid)) {
      const age = Date.now() - fs.statSync(DAEMON_PID_FILE).mtimeMs
      if (age < 15_000) return { state: "starting", pid: candidatePid }
    }
  } catch {}
  return { state: "offline", pid: null }
}

/**
 * Stop whatever daemon is around and spawn a fresh one, detached, logging into
 * daemon.log. Returns the failure as a message rather than throwing: every
 * caller treats "no daemon" as a state to report, not an exception.
 */
export function startDaemon(connector: Record<string, unknown> | null): {
  success: boolean
  pid?: number
  message: string
} {
  try {
    const stopDaemon = connector?.stopDaemon as (() => void) | undefined
    stopDaemon?.call(connector)
  } catch {}

  const portableNodeDir = PORTABLE_NODE_DIR
  const openagentsDir = CONFIG_DIR

  const extraDirs = [portableNodeDir, path.join(portableNodeDir, "bin")]
  const runtimesDir = path.join(openagentsDir, "runtimes")
  try {
    for (const d of fs.readdirSync(runtimesDir, { withFileTypes: true })) {
      if (d.isDirectory())
        extraDirs.push(path.join(runtimesDir, d.name, "node_modules", ".bin"))
    }
  } catch {}
  extraDirs.push(path.join(openagentsDir, "core", "node_modules", ".bin"))
  extraDirs.push(path.join(portableNodeDir, "node_modules", ".bin"))
  if (process.platform === "win32") {
    extraDirs.push(path.join(process.env.APPDATA || "", "npm"))
    try {
      const { execSync: _exec } = require("child_process")
      const npmPrefix = _exec("npm config get prefix", {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      }).trim()
      if (npmPrefix && !extraDirs.includes(npmPrefix)) extraDirs.push(npmPrefix)
    } catch {}
  }
  const enhancedPath = [...extraDirs, process.env.PATH || ""].join(
    path.delimiter,
  )

  // The daemon runs the same core the app does — newest first, see coreTiers.
  // That ordering matters as much here as in-process: the daemon is what
  // actually drives the adapters, so a runtime-downloaded core older than the
  // one packaged with the app would keep running yesterday's agents.
  //
  // Paths are rewritten out of app.asar because the packaged copy has to be a
  // real on-disk file the spawned node can execute. Having it at all is what
  // lets the daemon start when the downloaded core never landed (offline /
  // AV-blocked) — the failure that used to strand Windows users at "Daemon
  // failed to start".
  const tiers = coreTiers()
  if (!tiers.some((t) => t.source === "bundled"))
    appendDaemonLog("bundled agent-launcher CLI unresolvable")

  let cliPath: string | null = null
  const cliCandidates = tiers.map((t) =>
    unpackedPath(path.join(t.dir, "bin", "agent-connector.js")),
  )
  for (const c of cliCandidates) {
    try {
      if (fs.existsSync(c)) {
        cliPath = c
        break
      }
    } catch {}
  }
  if (!cliPath) {
    appendDaemonLog(
      `agent-launcher CLI not found; checked ${cliCandidates.join(", ")}`,
    )
    return {
      success: false,
      message:
        "agent-launcher CLI not found. Install an agent first via the Install tab.",
    }
  }

  // Pick a node binary that actually launches. The bundled portable
  // node.exe is preferred when usable, but on some Windows machines it's
  // blocked by Defender / SmartScreen and CreateProcess fails. When neither
  // a portable nor a system node is usable, fall back to running THIS
  // Electron binary as a plain Node process (ELECTRON_RUN_AS_NODE=1) —
  // Electron is always present, so the daemon can start without depending on
  // a separately-installed node runtime.
  let nodeBin = resolveWorkingNode(portableNodeDir, enhancedPath)
  const daemonEnv: NodeJS.ProcessEnv = { ...process.env }
  if (!nodeBin) {
    nodeBin = process.execPath
    daemonEnv.ELECTRON_RUN_AS_NODE = "1"
    appendDaemonLog(
      `no portable/system node usable; running daemon via Electron-as-node (${nodeBin})`,
    )
  }

  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    const logFd = fs.openSync(DAEMON_LOG_FILE, "a")
    appendDaemonLog(`starting daemon: node="${nodeBin}" cli="${cliPath}"`)

    // `detached` is what keeps this invisible on Windows: it maps to
    // DETACHED_PROCESS, so the daemon runs with no console at all. (windowsHide
    // can't help here — libuv only applies CREATE_NO_WINDOW when no stdio fd is
    // inherited, and the log fds are.) The corollary bit us: a console-less
    // parent means every console child the daemon spawns gets a *fresh* console
    // window unless it hides itself — which the core now defaults in
    // win-console.js.
    const proc = spawn(nodeBin, [cliPath, "up", "--foreground"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: withPathEnv(enhancedPath, daemonEnv),
      windowsHide: true,
    })
    proc.once("error", (err: Error) => {
      appendDaemonLog(`daemon spawn error: ${err.message}`)
    })
    proc.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      appendDaemonLog(
        `daemon process exited early: code=${code ?? "null"} signal=${signal ?? "null"}`,
      )
    })
    proc.unref()
    fs.writeFileSync(DAEMON_PID_FILE, String(proc.pid), "utf-8")
    fs.closeSync(logFd)

    return {
      success: true,
      pid: proc.pid,
      message: `Daemon started (PID ${proc.pid})`,
    }
  } catch (e: unknown) {
    return {
      success: false,
      message: `Failed to start daemon: ${(e as Error).message}`,
    }
  }
}
