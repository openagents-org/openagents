/**
 * The startup log and the last-resort crash reporter.
 *
 * `~/.openagents/startup.log` is the first thing support asks for, so writing
 * to it must never itself throw, and it must stay openable — hence the single
 * rotation below.
 *
 * NOTE: the `process.on("uncaughtException" / "unhandledRejection")` handlers
 * that call reportStartupError are deliberately NOT registered here. They are
 * registered at module scope in index.ts so they cover the window between
 * `require` and `whenReady`; moving the registration into this module would
 * change when it takes effect.
 */
import path from "path"
import fs from "fs"
import os from "os"
import { app, dialog } from "electron"
import { t } from "../i18n"

export const STARTUP_LOG = path.join(os.homedir(), ".openagents", "startup.log")
// One rotation, checked once per launch. This file is the first thing support
// asks for, so it has to stay openable — append-only with no ceiling meant a
// long-lived install grew it without bound. One previous generation is kept:
// enough to cover "it broke, I restarted, now tell me what happened".
const STARTUP_LOG_MAX_BYTES = 1_000_000
let logRotated = false
function rotateStartupLogOnce(): void {
  if (logRotated) return
  logRotated = true
  try {
    if (fs.statSync(STARTUP_LOG).size < STARTUP_LOG_MAX_BYTES) return
    fs.renameSync(STARTUP_LOG, `${STARTUP_LOG}.1`)
  } catch {
    // No log yet, or the rename lost a race with another instance — either way
    // the append below still works.
  }
}

export function slog(msg: string): void {
  try {
    fs.mkdirSync(path.dirname(STARTUP_LOG), { recursive: true })
    rotateStartupLogOnce()
    fs.appendFileSync(STARTUP_LOG, `${new Date().toISOString()} ${msg}\n`)
  } catch {}
  console.log("[startup]", msg)
}

/**
 * Set once a window exists. Before that, a thrown error means the user is
 * looking at nothing at all; after it, the UI is up and a stray rejection is
 * not worth killing the app over.
 */
let startupReachedUi = false

/** Called once the first window is on screen. */
export function markUiReached(): void {
  startupReachedUi = true
}

/**
 * Startup died before a window existed. Until this was here the whole boot
 * chain hung off an uncaught `app.whenReady().then(…)`: anything that threw
 * (an unreadable path under a non-ASCII home dir, a half-extracted runtime)
 * rejected silently, no window ever opened, and the process just went away —
 * "the installer finishes and then nothing happens, it won't open". Say what
 * broke and where the log is, then leave.
 */
let fatalReported = false
export function reportStartupError(err: unknown): void {
  slog("FATAL: " + ((err as Error)?.stack || String(err)))
  // Past the first window the app is usable; log it and carry on rather than
  // pulling the rug out from under whatever the user is doing.
  if (startupReachedUi || fatalReported) return
  fatalReported = true
  try {
    dialog.showErrorBox(
      t("startupFailedTitle"),
      t("startupFailedBody", {
        message: ((err as Error)?.message || String(err)).slice(0, 500),
        log: STARTUP_LOG,
      }),
    )
  } catch {}
  app.exit(1)
}
