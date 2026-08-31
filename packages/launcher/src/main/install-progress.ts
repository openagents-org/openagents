/**
 * Turning an installer's stdout into something a progress bar can show.
 *
 * npm/curl/tar output arrives as unstructured chunks, so the phase is inferred
 * from the text (`classifyInstallChunk`) and the renderer is told about every
 * transition. The other half is error copy: a raw "ENOENT" or "short read"
 * means nothing to a user, so `userFacingInstallError` maps the common
 * failures onto what actually went wrong and what to do about it.
 *
 * Everything streamed is also written to a file under ~/.openagents/installs/.
 * Until it was, an install log lived only in the renderer's memory, and the one
 * screen showing it disappeared the moment the user left the detail page — so
 * the only way to see why an install failed was to reproduce it.
 */
import fs from "fs"
import path from "path"
import type { BrowserWindow } from "electron"

import { CONFIG_DIR } from "./agents/paths"

export type InstallPhase =
  | "idle"
  | "preparing"
  | "downloading"
  | "installing"
  | "verifying"
  | "done"
  | "error"
export type InstallVerb = "install" | "update" | "uninstall" | "rollback"

/**
 * One missing dependency, as reported by the core's install preflight. The
 * shape is defined there (agent-connector/src/install-preflight.js); it is
 * carried through to the renderer so the UI can offer a button instead of
 * parsing prose out of an error message.
 */
export interface PrereqRemedy {
  name: string
  action: string | null
  summary: string
  command: string
  alternative: string | null
  /**
   * Key for the localized wording of `summary`; `summary` itself is the
   * English fallback the core also writes to the CLI and the install log.
   */
  summaryKey?: string
  /**
   * Which tool `alternative` uses ("homebrew", "winget", "pipx"), so the row
   * can be labelled for the platform the user is actually on.
   */
  alternativeKind?: string | null
}

export interface InstallProgressPayload {
  agent: string
  verb: InstallVerb
  phase: InstallPhase
  detail?: string
  log?: string
  error?: string
  /** Present when the install was refused for a missing dependency. */
  missing?: PrereqRemedy[]
  /** Absolute path to this run's log file, once one has been opened. */
  logFile?: string
}

/** Where install logs are kept, one file per run. */
export const INSTALL_LOG_DIR = path.join(CONFIG_DIR, "installs")

/** How many log files to keep before the oldest are pruned. */
const KEEP_LOGS = 30

interface MissingPrereq {
  message: string
  missing: PrereqRemedy[]
}

/**
 * The core refuses to run a third-party installer whose hard dependencies are
 * missing, and throws an error carrying the remedies. That message is already
 * written for a human, so it is passed through verbatim rather than being run
 * through userFacingInstallError's "Failed while …" phrasing.
 */
export function asMissingPrereq(err: unknown): MissingPrereq | null {
  if (!err || typeof err !== "object") return null
  const e = err as { code?: unknown; missing?: unknown; message?: unknown }
  if (e.code !== "MISSING_PREREQ" || !Array.isArray(e.missing)) return null
  return {
    message: String(e.message || ""),
    missing: e.missing as PrereqRemedy[],
  }
}

/**
 * A file the run's output is mirrored into. Every operation is best-effort: a
 * failure to write a log must never fail an install.
 */
function openInstallLog(
  agent: string,
  verb: InstallVerb,
  stamp: string,
): { file: string | undefined; write: (chunk: string) => void; close: () => void } {
  let handle: number | null = null
  let file: string | undefined
  try {
    fs.mkdirSync(INSTALL_LOG_DIR, { recursive: true })
    pruneInstallLogs()
    file = path.join(INSTALL_LOG_DIR, `${agent}-${verb}-${stamp}.log`)
    handle = fs.openSync(file, "a")
    fs.writeSync(handle, `# ${verb} ${agent} — ${new Date().toISOString()}\n\n`)
  } catch {
    handle = null
    file = undefined
  }
  return {
    file,
    write: (chunk: string) => {
      if (handle === null) return
      try {
        fs.writeSync(handle, chunk)
      } catch {
        /* disk full, file removed mid-run — keep installing */
      }
    },
    close: () => {
      if (handle === null) return
      try {
        fs.closeSync(handle)
      } catch {
        /* already gone */
      }
      handle = null
    },
  }
}

/** Keep the newest KEEP_LOGS files; these are diagnostics, not history. */
function pruneInstallLogs(): void {
  try {
    const entries = fs
      .readdirSync(INSTALL_LOG_DIR)
      .filter((f) => f.endsWith(".log"))
      .sort()
    for (const stale of entries.slice(0, Math.max(0, entries.length - KEEP_LOGS))) {
      try {
        fs.unlinkSync(path.join(INSTALL_LOG_DIR, stale))
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* directory unreadable — nothing to prune */
  }
}

/** Sortable, filename-safe timestamp: 20260820-124701. */
export function logStamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0")
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  )
}

export function installStepLabel(
  phase: InstallPhase,
  verb: InstallVerb,
): string {
  if (phase === "downloading") return "downloading"
  if (phase === "verifying") return "verifying the installation"
  if (phase === "installing") {
    if (verb === "uninstall") return "removing files"
    if (verb === "rollback") return "rolling back"
    if (verb === "update") return "installing the update"
    return "running the installer"
  }
  if (phase === "preparing" || phase === "idle")
    return "preparing the installer"
  return "finishing the installation"
}

export function userFacingInstallError(
  err: unknown,
  phase: InstallPhase,
  verb: InstallVerb,
): string {
  const raw = err instanceof Error ? err.message : String(err || "")
  const text = raw.toLowerCase()
  const step = installStepLabel(phase, verb)

  let reason = "The installer stopped before it could finish."
  let hint = "Open the log for details, then try again."

  // Git failures are checked FIRST, ahead of the generic network and
  // permission buckets. An installer that dies fetching PortableGit prints a
  // stack full of "timeout"/"ssl", which the network branch would happily
  // claim — and "check your VPN" is the wrong advice for a machine that simply
  // has no Git.
  if (
    text.includes("could not install portable git") ||
    text.includes("portablegit extraction")
  ) {
    // Windows: install.ps1 downloads PortableGit from github.com when the
    // machine has no usable git. ~50MB, no admin needed, and its own error
    // names no cause.
    reason = "Windows needs Git, and downloading a portable copy failed."
    hint =
      "Install Git from https://git-scm.com/download/win, then retry — or check whether your network blocks github.com."
  } else if (
    text.includes("msys programs") ||
    text.includes("git bash installation could not be located") ||
    (text.includes("git bash") && text.includes("cannot launch"))
  ) {
    // Windows: git IS installed, but its bash cannot start MSYS programs —
    // usually mandatory ASLR from an endpoint-security policy. The installer's
    // own wording means nothing to anyone who has not read its source.
    reason = "The Git Bash on this machine cannot run the programs this agent needs."
    hint =
      "This is usually a Windows security policy (mandatory ASLR) blocking Git Bash. Reinstall Git for Windows, or exempt bash.exe, then retry."
  } else if (
    text.includes("xcode-select") ||
    text.includes("command line developer tools") ||
    text.includes("git not found")
  ) {
    // The installer got far enough to discover git is missing on its own. On
    // macOS it handles that by opening a system dialog and polling for 15
    // minutes, so say what actually needs to happen instead of "try again".
    reason = "Git is missing, and this agent's installer needs it."
    hint =
      "Run `xcode-select --install` (macOS) or install Git for your system, then retry."
  } else if (
    text.includes("not recognized as an internal or external command") ||
    text.includes("not recognized") ||
    text.includes("enoent") ||
    text.includes("command not found")
  ) {
    reason = "A required command could not be started."
    hint =
      "Check that the required tool is installed and available, then try again."
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

export function classifyInstallChunk(
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
    // A size, not the letters "mb" anywhere in the line — that bare substring
    // matched ordinary words ("number", "symbol", "assembly") and pinned the
    // progress bar to "downloading" for output that had nothing to do with a
    // download, which is how a failure at a completely different step came to
    // be reported as "Failed while downloading".
    /\b\d+(?:\.\d+)?\s*[mg]b\b/.test(line)
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

/**
 * Broadcasts install phase/output to the renderer. Takes the window as a
 * getter rather than a value: `mainWindow` is reassigned across the app's
 * lifetime (closed and reopened from the tray), so a captured reference would
 * go stale and progress would silently stop showing.
 */
export class InstallProgress {
  constructor(private getWindow: () => BrowserWindow | null) {}

  broadcast(payload: InstallProgressPayload): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send("install:progress", payload)
    }
  }

  async run<T>(
    agent: string,
    verb: InstallVerb,
    runner: (onData: (data: string) => void) => Promise<T>,
  ): Promise<T> {
    let currentPhase: InstallPhase = "preparing"
    const log = openInstallLog(agent, verb, logStamp(new Date()))
    this.broadcast({
      agent,
      verb,
      phase: "preparing",
      detail: "Resolving dependencies",
      logFile: log.file,
    })

    const onData = (data: string): void => {
      log.write(data)
      const win = this.getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send("install:output", data)
      const { phase, detail } = classifyInstallChunk(data, verb)
      if (phase && phase !== currentPhase) {
        currentPhase = phase
        this.broadcast({ agent, verb, phase, detail, logFile: log.file })
      } else if (detail) {
        this.broadcast({ agent, verb, phase: currentPhase, detail, logFile: log.file })
      }
    }

    try {
      const result = await runner(onData)
      log.close()
      this.broadcast({
        agent,
        verb,
        phase: "done",
        detail: "Complete",
        logFile: log.file,
      })
      return result
    } catch (e: unknown) {
      const prereq = asMissingPrereq(e)
      const friendlyError = prereq
        ? prereq.message
        : userFacingInstallError(e, currentPhase, verb)
      log.write(`\n${friendlyError}\n`)
      log.close()
      this.broadcast({
        agent,
        verb,
        phase: "error",
        // The prereq message is several lines of instructions; the detail line
        // is a single truncated row, so it gets the summary and the UI renders
        // the rest from `missing`.
        detail: prereq
          ? prereq.missing.map((m) => m.summary).join(" ")
          : friendlyError,
        error: friendlyError,
        missing: prereq?.missing,
        logFile: log.file,
      })
      // What is thrown becomes a toast, so a refused install gets the one-line
      // summary; the full instructions are already on screen in the progress
      // block and in the log file.
      throw new Error(
        prereq ? prereq.missing.map((m) => m.summary).join(" ") : friendlyError,
      )
    }
  }
}
