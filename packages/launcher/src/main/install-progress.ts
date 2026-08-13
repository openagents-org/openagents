/**
 * Turning an installer's stdout into something a progress bar can show.
 *
 * npm/curl/tar output arrives as unstructured chunks, so the phase is inferred
 * from the text (`classifyInstallChunk`) and the renderer is told about every
 * transition. The other half is error copy: a raw "ENOENT" or "short read"
 * means nothing to a user, so `userFacingInstallError` maps the common
 * failures onto what actually went wrong and what to do about it.
 */
import type { BrowserWindow } from "electron"

export type InstallPhase =
  | "idle"
  | "preparing"
  | "downloading"
  | "installing"
  | "verifying"
  | "done"
  | "error"
export type InstallVerb = "install" | "update" | "uninstall" | "rollback"

export interface InstallProgressPayload {
  agent: string
  verb: InstallVerb
  phase: InstallPhase
  detail?: string
  log?: string
  error?: string
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

  if (
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
    this.broadcast({
      agent,
      verb,
      phase: "preparing",
      detail: "Resolving dependencies",
    })

    const onData = (data: string): void => {
      const win = this.getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send("install:output", data)
      const { phase, detail } = classifyInstallChunk(data, verb)
      if (phase && phase !== currentPhase) {
        currentPhase = phase
        this.broadcast({ agent, verb, phase, detail })
      } else if (detail) {
        this.broadcast({ agent, verb, phase: currentPhase, detail })
      }
    }

    try {
      const result = await runner(onData)
      this.broadcast({ agent, verb, phase: "done", detail: "Complete" })
      return result
    } catch (e: unknown) {
      const friendlyError = userFacingInstallError(e, currentPhase, verb)
      this.broadcast({
        agent,
        verb,
        phase: "error",
        detail: friendlyError,
        error: friendlyError,
      })
      throw new Error(friendlyError)
    }
  }
}
