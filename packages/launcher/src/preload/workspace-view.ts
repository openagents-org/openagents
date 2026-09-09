import { ipcRenderer } from "electron"

/**
 * Preload for the embedded workspace page — the only thing that crosses from
 * the launcher into that origin.
 *
 * It plants the signed-in session where the workspace app already looks for it
 * (`localStorage.oa_workspace_session`, see the web app's lib/workspace-session),
 * so the page comes up signed in with no web code aware it is inside a desktop
 * app. Session state cannot be shared any other way: the launcher's own UI is a
 * file:// origin and the workspace is https, and browser auth is per-origin.
 *
 * It also carries the API base, for a self-hosted deployment: the bundle reads
 * it from a global that index.html defaults, and this runs first.
 *
 * And it reports the session BACK, because the workspace signs people in on
 * its own pages: the launcher's rail shows the account and the workspace list,
 * and it has no other way to learn that someone signed in. A navigation is not
 * a usable signal — the app routes on the hash, so signing in never fires
 * one.
 *
 * Synchronous on purpose. Both have to be in place before the page's first
 * script reads them, and an async round-trip lands a frame too late — the app
 * would render its signed-out gate, against the wrong endpoint, and only then
 * be told otherwise.
 */

/**
 * Declared rather than pulled in from the DOM lib: this project's main/preload
 * tsconfig deliberately excludes DOM types (main must not reach for browser
 * globals), and this file needs exactly two methods of one of them.
 */
declare const window: {
  localStorage: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
    removeItem: (key: string) => void
  }
}

const STORAGE_KEY = "oa_workspace_session"

/** Where the bundle reads its API base from; see the workspace vite config. */
declare const globalThis: { __OA_API_URL__?: string }

interface EmbeddedSession {
  token: string
  email: string
  displayName: string | null
  expiresAt: number
}

try {
  const config = ipcRenderer.sendSync("workspace-view:config") as {
    session: EmbeddedSession | null
    apiUrl?: string
  }
  // Only when configured: the bundle's own default is the hosted endpoint, and
  // overriding it with the same value would just be noise.
  if (config?.apiUrl) globalThis.__OA_API_URL__ = config.apiUrl

  const session = config?.session ?? null
  if (session) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } else {
    // Signed out in the launcher means signed out here: leaving the old value
    // behind would show a stale account inside a signed-out app.
    window.localStorage.removeItem(STORAGE_KEY)
  }
  watchSession(session)
} catch (err) {
  // No session is a recoverable state — the page falls back to its own sign-in
  // gate, which is exactly what a browser visitor would see.
  console.error("workspace session injection failed:", err)
}

/**
 * Tell the launcher whenever the stored session changes.
 *
 * Polled rather than hooked: `storage` events only fire for OTHER documents on
 * the origin, so the page writing its own session is precisely the case they
 * miss. Two seconds is far below what anyone notices between signing in and
 * the rail catching up, and reading one key costs nothing.
 */
function watchSession(initial: EmbeddedSession | null): void {
  let last = initial ? initial.token : null
  setInterval(() => {
    let current: EmbeddedSession | null = null
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      current = raw ? (JSON.parse(raw) as EmbeddedSession) : null
    } catch {
      return
    }
    const token = current?.token ?? null
    if (token === last) return
    last = token
    ipcRenderer.send("workspace-view:session-changed", current)
  }, 2000)
}
