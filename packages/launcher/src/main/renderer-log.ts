import fs from "fs"
import os from "os"
import path from "path"

/**
 * Persist renderer console output to ~/.openagents/renderer.log.
 *
 * The renderer's console is invisible outside DevTools, which makes remote
 * machines (SSH-only Windows boxes especially) undiagnosable: a renderer
 * exception leaves no trace anywhere on disk. This mirrors every
 * console-message, load failure, and renderer crash into a plain append-only
 * file that `agn`-style tooling and GET /logs on the control server can tail.
 *
 * Rotation is single-generation: at ~2 MiB the file is renamed to
 * renderer.log.old (replacing the previous .old) and a fresh file begins.
 * That bounds disk use at ~4 MiB while always retaining recent history.
 */

const MAX_BYTES = 2 * 1024 * 1024

export function rendererLogPath(): string {
  return path.join(os.homedir(), ".openagents", "renderer.log")
}

const LEVELS = ["debug", "log", "warn", "error"] as const

/**
 * Fields of Electron >= 32's console-message event object. Older Electrons
 * pass positional args instead; attachRendererLogging accepts both.
 */
interface ConsoleMessageEvent {
  message?: string
  level?: number | string
  lineNumber?: number
  sourceId?: string
}

export function appendRendererLog(line: string, file = rendererLogPath()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try {
      if (fs.statSync(file).size >= MAX_BYTES) {
        fs.renameSync(file, `${file}.old`)
      }
    } catch {}
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // Logging must never break the app.
  }
}

/**
 * Shape-only view of the WebContents events we consume, so this module stays
 * Electron-free and unit-testable.
 */
export interface LoggableWebContents {
  on(
    event: "console-message",
    listener: (
      e: unknown,
      level?: number,
      message?: string,
      line?: number,
      sourceId?: string,
    ) => void,
  ): void
  on(
    event: "render-process-gone",
    listener: (e: unknown, details: { reason?: string; exitCode?: number }) => void,
  ): void
  on(
    event: "did-fail-load",
    listener: (
      e: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
    ) => void,
  ): void
}

/** Wire a window's console/crash/load events into the renderer log. */
export function attachRendererLogging(
  contents: LoggableWebContents,
  file = rendererLogPath(),
): void {
  contents.on(
    "console-message",
    (e, legacyLevel, legacyMessage, legacyLine, legacySourceId) => {
      // Electron >= 32 puts everything on the event object; the positional
      // args are deprecated (and eventually absent). Prefer the event fields,
      // fall back to positional for older runtimes.
      const ev = (e || {}) as ConsoleMessageEvent
      const message = ev.message ?? legacyMessage ?? ""
      const rawLevel = ev.level ?? legacyLevel
      const lvl =
        typeof rawLevel === "string"
          ? rawLevel
          : LEVELS[rawLevel as number] || `level${rawLevel}`
      const line = ev.lineNumber ?? legacyLine
      const sourceId = ev.sourceId ?? legacySourceId
      // sourceId is a bundle URL — keep just the file part, the full URL is noise.
      const src = sourceId ? `${sourceId.split("/").pop()}:${line}` : ""
      appendRendererLog(`[${lvl}] ${src} ${message}`.trimEnd(), file)
    },
  )
  contents.on("render-process-gone", (_e, details) => {
    appendRendererLog(
      `[crash] renderer gone: ${details?.reason || "unknown"} (exit ${details?.exitCode ?? "?"})`,
      file,
    )
  })
  contents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    appendRendererLog(
      `[load-error] ${errorCode} ${errorDescription} ${validatedURL}`,
      file,
    )
  })
}
