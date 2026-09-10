import path from "path"
import { app, WebContentsView, session as electronSession } from "electron"
import type { BrowserWindow } from "electron"

import { apiBase, loginBase, webBase } from "./auth/endpoints"
import {
  allowBundleApiAccess,
  bundleExists,
  workspaceBundleUrl,
  WORKSPACE_HOST,
  WORKSPACE_PARTITION,
  WORKSPACE_SCHEME,
} from "./workspace-bundle"
import { openExternalSafely } from "./web-security"
import { slog } from "./bootstrap/startup-log"

/**
 * The workspace, hosted by the main process.
 *
 * The workspace front end is a 45k-line client-side app that already exists and
 * already works; the desktop app carries it rather than reimplementing it. It
 * is BUILT INTO the installer (workspace/frontend's second, Vite build target)
 * and served off disk over a custom scheme — so it opens instantly, works
 * offline, and loads nothing from a remote origin. See workspace-bundle.ts.
 *
 * It is drawn as a WebContentsView layered over the renderer, NOT a <webview>
 * tag — those arrive with their own unreviewed webPreferences and the renderer
 * is explicitly barred from creating them (see web-security). A view owned by
 * main keeps every navigation and permission decision on this side.
 *
 * The renderer decides where it goes: it measures the region of its own layout
 * that the workspace should fill and sends those bounds over. That keeps the
 * sidebar, the window chrome and every launcher dialog above it in the
 * renderer's own DOM, with only the workspace page itself living out here.
 */

export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface EmbeddedSession {
  token: string
  email: string
  displayName: string | null
  expiresAt: number
}

export interface WorkspaceHostDeps {
  getWindow: () => BrowserWindow | null
  /** The configured workspace endpoint, if any. */
  endpoint: () => string | undefined
  /** The session to plant in the page, or null when signed out. */
  session: () => EmbeddedSession | null
  /** Called when the page signs someone in — see `showSignIn`. */
  onSession: (session: EmbeddedSession) => void
  /**
   * Called when the sign-in has to leave the app: Google's and GitHub's OAuth
   * screens refuse to run in an embedded view, so those accounts finish in a
   * real browser and are handed back over loopback.
   */
  onExternalLogin: () => void
}

/**
 * Marks this view as the desktop app, for the pages that need to know.
 *
 * The workspace's login callback reads it: a sign-in happening in here has to
 * be exchanged for a workspace session server-side, because a Firebase session
 * lives in the page and the launcher cannot keep one.
 */
export const LAUNCHER_UA_TAG = "OpenAgentsLauncher"

/** Where the workspace app keeps its session; the login result is read here. */
const SESSION_KEY = "oa_workspace_session"

export class WorkspaceHost {
  private _view: WebContentsView | null = null
  private _attached = false
  private _url: string | null = null
  private _bounds: ViewBounds = { x: 0, y: 0, width: 0, height: 0 }
  /** The window whose reloads are already being watched. See _guardAgainstReload. */
  private _guardedWindow: BrowserWindow | null = null

  constructor(private _deps: WorkspaceHostDeps) {
    // The bundle's origin is not one the API's CORS allowlist knows; this is
    // what lets it call the API at all. Set up once, before any view exists.
    allowBundleApiAccess(apiBase(_deps.endpoint()), webBase(_deps.endpoint()))
  }

  /** Tell the hosted app the launcher's look and feel changed. */
  sendAppearance(next: { theme: string; locale: string }): void {
    this._view?.webContents.send("workspace-view:appearance", next)
  }

  /** The session the preload asks for, synchronously, at page start. */
  currentSession(): EmbeddedSession | null {
    return this._deps.session()
  }

  /**
   * Put the workspace on screen at `bounds`, loading it if it is not already
   * the page in the view.
   *
   * @param target workspace slug or id — the path the web app routes on.
   * @param token the workspace's shared access token, when the caller has one.
   *   It grants nothing new: the page uses it exactly as a browser would from
   *   a shared link.
   */
  show(target: string, bounds: ViewBounds, token?: string | null): void {
    const window = this._deps.getWindow()
    if (!window) return
    this._guardAgainstReload(window)

    const view = this._ensureView()
    // Without a bundle there is nothing local to show; fall back to the hosted
    // app so a dev checkout that has not run the workspace build still works.
    const local = bundleExists()
    const url = local
      ? this._urlFor(target, token)
      : `${webBase(this._deps.endpoint())}/${encodeURIComponent(target)}`
    if (url !== this._url) {
      this._url = url
      view.webContents.loadURL(url).catch((err) => {
        slog(`[workspace-view] load failed: ${(err as Error).message}`)
      })
    }

    if (!this._attached) {
      window.contentView.addChildView(view)
      this._attached = true
    }
    this.setBounds(bounds)
  }

  /**
   * Watch for the session the login leaves behind.
   *
   * Every landing on the workspace origin is a candidate: the sign-in ends by
   * navigating there, and the page writes its session before it renders. Read
   * rather than pushed, because the page has no idea it is inside an app —
   * which is the whole point of reusing it.
   */
  private async _readSession(url: string): Promise<void> {
    const view = this._view
    if (!view) return
    let origin: string
    try {
      origin = new URL(url).origin
    } catch {
      return
    }
    if (origin !== new URL(webBase(this._deps.endpoint())).origin) return

    try {
      const raw = (await view.webContents.executeJavaScript(
        `window.localStorage.getItem(${JSON.stringify(SESSION_KEY)})`,
      )) as string | null
      if (!raw) return
      const session = JSON.parse(raw) as EmbeddedSession
      if (session?.token && session?.email) this._deps.onSession(session)
    } catch (err) {
      slog(`[workspace-view] reading the session failed: ${(err as Error).message}`)
    }
  }

  /**
   * Take the view down when the launcher's own page reloads.
   *
   * A reload (⌘R, or a dev-server rebuild) destroys the renderer without
   * running any effect cleanup, so the page that asked for this view never
   * gets to ask for it to go. The view is native and survives: it stays
   * pinned over a launcher that has come back up in launcher mode and has no
   * idea it is there. What the user sees is a workspace painted on top of a
   * launcher that is live underneath — clicks land on whichever half owns the
   * pixel, and neither is usable.
   *
   * Only main can fix this, because only main outlives the reload. Bound on
   * the first `show` rather than at construction: that is the first moment the
   * window is certain to exist, and before it there is nothing to strand.
   */
  private _guardAgainstReload(window: BrowserWindow): void {
    if (this._guardedWindow === window) return
    this._guardedWindow = window
    // Fires for the first load too, when there is no view yet and `hide` is a
    // no-op. The workspace's own navigation goes to its own webContents and
    // never reaches this one.
    window.webContents.on("did-start-loading", () => {
      this.hide()
      // The view has been navigating on its own since we last set this — the
      // user opening workspace settings, say. `show` skips loading when the
      // URL it wants is the one it last asked for, so after a reload it would
      // hand back a view sitting on a route nobody asked for, and a page that
      // was broken stays broken across every reload. Forgetting the URL makes
      // the next `show` a real navigation.
      this._url = null
    })
  }

  setBounds(bounds: ViewBounds): void {
    this._bounds = bounds
    // Rounded, not truncated: fractional device pixels leave a hairline of the
    // page behind the view showing along one edge.
    this._view?.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    })
  }

  /**
   * Take the workspace off screen without discarding it — the page keeps its
   * scroll position, its open channel and its event stream, so switching back
   * to it is instant rather than a fresh load.
   */
  hide(): void {
    if (!this._attached || !this._view) return
    this._deps.getWindow()?.contentView.removeChildView(this._view)
    this._attached = false
  }

  reload(): void {
    this._view?.webContents.reload()
  }

  /**
   * Tear the view down and forget everything that origin stored.
   *
   * Called on sign-out: the injected session lives in that origin's
   * localStorage, so leaving it behind would keep a signed-in workspace one
   * click away from a launcher that believes it signed the user out.
   */
  async signOut(): Promise<void> {
    this.destroy()
    try {
      await electronSession.fromPartition(WORKSPACE_PARTITION).clearStorageData()
    } catch (err) {
      slog(`[workspace-view] clearing storage failed: ${(err as Error).message}`)
    }
  }

  destroy(): void {
    this.hide()
    this._view?.webContents.close()
    this._view = null
    this._url = null
  }

  /**
   * The URL for a workspace inside the bundle.
   *
   * Hash routing (see the bundle's desktop/router), so the token rides in the
   * hash query rather than the URL's: a workspace this device is paired to but
   * the account is not a member of still opens, with the device's own token,
   * exactly as a browser would from a shared link.
   */
  private _urlFor(target: string, token?: string | null): string {
    const route = target ? `/${encodeURIComponent(target)}` : "/"
    const query = token ? `?token=${encodeURIComponent(token)}` : ""
    return workspaceBundleUrl(`${route}${query}`)
  }

  private _ensureView(): WebContentsView {
    if (this._view) return this._view

    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "../preload/workspace-view.js"),
        contextIsolation: true,
        nodeIntegration: false,
        partition: WORKSPACE_PARTITION,
      },
    })
    view.setBackgroundColor("#00000000")
    // Identifies the desktop app to our own pages. Appended, so everything the
    // sites already branch on (platform, engine) still reads true.
    view.webContents.setUserAgent(
      `${view.webContents.getUserAgent()} ${LAUNCHER_UA_TAG}/${app.getVersion()}`,
    )
    this._hardenNavigation(view.webContents)
    // Whatever goes wrong in here is invisible otherwise: the view has no
    // window chrome, and a page that fails to load looks exactly like one that
    // loaded and rendered nothing.
    view.webContents.on(
      "did-fail-load",
      (_e, code, description, validatedURL, isMainFrame) => {
        slog(
          `[workspace-view] did-fail-load ${code} ${description} — ${validatedURL}`,
        )
        if (!isMainFrame) return
        // A page we shipped cannot fail to load; anything that does is somewhere
        // the sign-in took us, and the error page it leaves behind is a dead
        // end — no navigation, no way back, nothing on screen to explain it.
        // Returning to the bundle at least puts the user somewhere with exits.
        if (this._url && !validatedURL.startsWith(this._url)) {
          void view.webContents.loadURL(this._url)
        }
      },
    )
    view.webContents.on("render-process-gone", (_e, details) =>
      slog(`[workspace-view] renderer gone: ${details.reason}`),
    )
    // The page's own console, which is where a React error lands.
    view.webContents.on("console-message", (event) => {
      if (event.level === "error" || event.level === "warning") {
        slog(`[workspace-view] console: ${event.message}`)
      }
    })
    // The bundle is a page like any other and its console is the only place
    // its errors appear — but it has no window chrome to open one from. Opt in
    // when debugging it: OPENAGENTS_WORKSPACE_DEVTOOLS=1.
    if (process.env.OPENAGENTS_WORKSPACE_DEVTOOLS === "1") {
      view.webContents.openDevTools({ mode: "detach" })
    }
    // Both events, deliberately: a sign-in can end in a full navigation or in
    // a client-side route change, and only one of them fires for each.
    view.webContents.on("did-navigate", (_e, url) => void this._readSession(url))
    view.webContents.on(
      "did-navigate-in-page",
      (_e, url) => void this._readSession(url),
    )
    this._view = view
    this.setBounds(this._bounds)
    return view
  }

  /**
   * What this view is allowed to do.
   *
   * Unlike the launcher's own window, this one is *supposed* to navigate — it
   * is a web app — so the rule is an origin allowlist rather than a flat
   * refusal: anywhere on the workspace's own origin is in-app navigation, and
   * everything else (a doc link, a third-party OAuth screen, a shared file on
   * another host) belongs in the user's browser, where it has a real address
   * bar to be judged by.
   */
  /** Whether the view currently sits on the account site's sign-in. */
  private _onLoginPage(): boolean {
    try {
      return (
        new URL(this._view?.webContents.getURL() || "").origin ===
        new URL(loginBase()).origin
      )
    } catch {
      return false
    }
  }

  /**
   * Move a sign-in that cannot finish here out to the browser, and put the page
   * back the way it was.
   *
   * The reload is the point of this being a method. A provider button opens a
   * popup and then waits for it to report back; refusing the popup leaves the
   * page waiting forever, with every button stuck on "Signing in…" and no way
   * for the user to pick a different method.
   */
  private _handOffToBrowser(): void {
    slog("[workspace-view] sign-in needs a real browser — restarting it there")
    this._deps.onExternalLogin()
    this._view?.webContents.reload()
  }

  private _hardenNavigation(contents: Electron.WebContents): void {
    // The workspace and the account site it signs people in on. Everything
    // else — a doc link, a shared file, and notably Google's and GitHub's own
    // OAuth screens — goes to the browser, where it has an address bar to be
    // judged by and where those providers will actually serve it.
    const allowed = [
      // The bundle itself.
      `${WORKSPACE_SCHEME}://${WORKSPACE_HOST}`,
      // The account site, for the sign-in that still runs on its own pages.
      new URL(loginBase()).origin,
      // The hosted workspace, for a deployment with no bundle to serve.
      new URL(webBase(this._deps.endpoint())).origin,
    ]

    contents.setWindowOpenHandler(({ url }) => {
      // Same reasoning as will-navigate: a provider popup opened from the login
      // page is that provider refusing to run in here.
      if (this._onLoginPage()) this._handOffToBrowser()
      else openExternalSafely(url)
      return { action: "deny" }
    })
    contents.on("will-navigate", (event, url) => {
      let origin: string
      try {
        origin = new URL(url).origin
      } catch {
        event.preventDefault()
        return
      }
      if (allowed.includes(origin)) return
      event.preventDefault()

      // Leaving mid-sign-in means the user chose a provider that will not
      // authenticate in here. Handing them the raw OAuth URL would strand the
      // sign-in in the browser, where it has no way back into the app: the
      // whole flow restarts out there instead, on the path that does.
      // Leaving the account site mid-sign-in means the user picked a provider
      // that will not authenticate in here. Handing them the raw OAuth URL
      // would strand the sign-in in the browser, where it has no way back into
      // the app; the whole flow restarts out there instead, on the path that
      // does have one.
      if (this._onLoginPage()) {
        this._handOffToBrowser()
        return
      }
      openExternalSafely(url)
    })
    contents.on("will-attach-webview", (event) => event.preventDefault())
  }
}
