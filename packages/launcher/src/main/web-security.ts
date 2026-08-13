/**
 * The rules for anything trying to leave the app or open a window.
 */
import { shell } from "electron"
import { slog } from "./bootstrap/startup-log"

/**
 * Hand a URL to the OS browser, or refuse it. The only path out of the app for
 * a link, shared by the IPC handler and the window guards below so a URL can
 * never take a laxer route than the one the renderer asks for explicitly.
 */
export function openExternalSafely(url: unknown): Promise<void> | void {
  let parsed: URL
  try {
    parsed = new URL(String(url))
  } catch {
    slog(`[shell] refusing to open malformed URL: ${String(url).slice(0, 200)}`)
    return
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    slog(`[shell] refusing to open non-web URL: ${parsed.protocol}`)
    return
  }
  return shell.openExternal(parsed.href)
}

/**
 * Lock a window's navigation surface down.
 *
 * contextIsolation and nodeIntegration were already set correctly, but nothing
 * governed where a window could NAVIGATE or what could open a NEW one. Any
 * `target="_blank"`, `window.open`, or stray `location =` would get a fresh
 * Electron window with no such review — a renderer-level bug, or any external
 * content that ever reaches the renderer, would escalate straight to a
 * browser-shaped window inside the app.
 *
 * Everything outbound goes through the OS browser instead, via the same
 * protocol check `shell:open-external` uses.
 */
export function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: "deny" }
  })
  contents.on("will-navigate", (event, url) => {
    // In-app navigation is only ever the renderer itself: the dev server, or
    // the packaged file:// bundle. Anything else is a link that belongs in the
    // user's browser.
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    const isRenderer = rendererUrl
      ? url.startsWith(rendererUrl)
      : url.startsWith("file://")
    if (isRenderer) return
    event.preventDefault()
    openExternalSafely(url)
  })
  contents.on("will-attach-webview", (event) => {
    // Nothing in the app uses <webview>; it would arrive with its own,
    // unreviewed webPreferences.
    event.preventDefault()
  })
}
