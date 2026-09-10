import { contextBridge, ipcRenderer } from "electron"

/**
 * Preload for the workspace the launcher hosts — the only thing that crosses
 * from the launcher into that app.
 *
 * It does three things, all of them before the page's first script runs:
 *
 *  - plants the signed-in session where the workspace already looks for it
 *    (`localStorage.oa_workspace_session`), so the app comes up signed in with
 *    no web code aware it is inside a desktop app
 *  - hands over the API base, so a self-hosted endpoint is a setting rather
 *    than a rebuild
 *  - hands over the look and feel — dark or light, and which language — so the
 *    two halves of one window cannot disagree about either
 *
 * All of it synchronously. Each has to be in place before the page reads it:
 * an async round-trip lands a frame late, which is a signed-out gate that
 * flashes, or a flash of the wrong theme.
 *
 * It also reports back — the session as it changes (the workspace signs people
 * in on its own pages, and the launcher's rail has no other way to learn it),
 * and the theme and language, so a change made on either side reaches the
 * other.
 */

/**
 * Declared rather than pulled in from the DOM lib: this project's main/preload
 * tsconfig deliberately excludes DOM types (main must not reach for browser
 * globals), and this file needs a few members of two of them.
 */
declare const window: {
  localStorage: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
    removeItem: (key: string) => void
  }
}
declare const globalThis: { __OA_API_URL__?: string }

const SESSION_KEY = "oa_workspace_session"
const THEME_KEY = "theme"

interface EmbeddedSession {
  token: string
  email: string
  displayName: string | null
  expiresAt: number
}

interface HostConfig {
  session: EmbeddedSession | null
  apiUrl?: string
  theme: "light" | "dark" | "system"
  locale: string
}

let config: HostConfig | null = null

try {
  config = ipcRenderer.sendSync("workspace-view:config") as HostConfig

  // Only when configured: the bundle's own default is the hosted endpoint, and
  // overriding it with the same value would just be noise.
  if (config?.apiUrl) globalThis.__OA_API_URL__ = config.apiUrl

  // Planted, never cleared. The workspace signs people in on its own pages, so
  // for most of this app's life ITS session is the only one there is — the
  // launcher learns about it from the watcher below. Treating "the launcher
  // has none" as "sign out" deleted exactly that session on every load, which
  // sent the app to a login it did not need.
  //
  // Signing out is a deliberate act and is handled where it belongs: the host
  // wipes this origin's storage (see workspace-host's signOut).
  if (config?.session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(config.session))
  }

  // next-themes reads this key as it initialises. Writing it here rather than
  // letting the page settle into its own choice is what keeps the window from
  // being dark on one side of the strip and light on the other.
  if (config?.theme) window.localStorage.setItem(THEME_KEY, config.theme)

  watch()
} catch (err) {
  // None of this is fatal: the app falls back to its own sign-in gate and its
  // own stored preferences, which is exactly what a browser visitor gets.
  console.error("workspace host handoff failed:", err)
}

/**
 * What the hosted app can ask of the launcher.
 *
 * Kept to the two settings that must not diverge. The desktop build reads this
 * (see the workspace's desktop/app.tsx) and falls back to its own behaviour
 * when it is absent — which is how the same code still runs on the web.
 */
contextBridge.exposeInMainWorld("__oaHost__", {
  appearance: {
    theme: config?.theme ?? "system",
    locale: config?.locale ?? "en-US",
  },
  /** The app changed its own theme; tell the launcher so the strip follows. */
  setTheme: (theme: string) =>
    ipcRenderer.send("workspace-view:theme-changed", theme),
  /** Likewise for language. */
  setLocale: (locale: string) =>
    ipcRenderer.send("workspace-view:locale-changed", locale),
  /** The launcher changed one of them. Returns an unsubscribe function. */
  onAppearance: (callback: (next: { theme: string; locale: string }) => void) => {
    const handler = (_e: unknown, next: { theme: string; locale: string }): void =>
      callback(next)
    ipcRenderer.on("workspace-view:appearance", handler)
    return () => ipcRenderer.removeListener("workspace-view:appearance", handler)
  },
})

/**
 * Report the session as it changes.
 *
 * Polled rather than hooked: `storage` events only fire for OTHER documents on
 * the origin, so the page writing its own session is precisely the case they
 * miss. Two seconds is far below what anyone notices between signing in and
 * the rail catching up, and reading one key costs nothing.
 */
function watch(): void {
  let lastToken = config?.session?.token ?? null

  setInterval(() => {
    let session: EmbeddedSession | null = null
    try {
      const raw = window.localStorage.getItem(SESSION_KEY)
      session = raw ? (JSON.parse(raw) as EmbeddedSession) : null
    } catch {
      return
    }
    const token = session?.token ?? null
    if (token === lastToken) return
    lastToken = token
    ipcRenderer.send("workspace-view:session-changed", session)
  }, 2000)
}
