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
import { crashLoopGuard } from "./responsiveness"
import { WORKSPACE_BUNDLE_MISSING } from "../shared/workspace-view"

/**
 * The workspace, hosted by the main process.
 *
 * The workspace front end is a 45k-line client-side app that already exists and
 * already works; the desktop app carries it rather than reimplementing it. It
 * is BUILT INTO the installer (workspace/frontend's second, Vite build target)
 * and served off disk over a custom scheme. Its assets are local; workspace
 * data still comes from the configured API. See workspace-bundle.ts.
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
  /**
   * The session to plant in the page, or null when signed out. Main is its
   * only owner: the page is told about changes and never reports one back.
   */
  session: () => EmbeddedSession | null
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

export class WorkspaceHost {
  private _view: WebContentsView | null = null
  private _attached = false
  private _url: string | null = null
  private _openHome = false
  private _bounds: ViewBounds = { x: 0, y: 0, width: 0, height: 0 }
  /** The window whose reloads are already being watched. See _guardAgainstReload. */
  private _guardedWindow: BrowserWindow | null = null
  /** The last sign-out's storage wipe. See whenCleared. */
  private _cleared: Promise<void> = Promise.resolve()
  /** Whether a crashed view should be reloaded. See responsiveness.ts. */
  private _shouldReloadView = crashLoopGuard()

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
   * Hand the loaded page the account's renewed session, so it keeps working
   * without a reload. A page loaded later picks it up from the preload.
   */
  sendSession(session: EmbeddedSession): void {
    this._view?.webContents.send("workspace-view:session", session)
  }

  /**
   * Show a launcher notice inside the page. The view is drawn above the
   * launcher's own DOM, so a toast raised there cannot be seen while the view
   * is on screen — and when it is not, the launcher's own toast is visible and
   * this one is not needed.
   */
  sendNotice(notice: { message: string; type: string }): void {
    if (this._attached) this._view?.webContents.send("workspace-view:notice", notice)
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
  show(target: string | null, bounds: ViewBounds, token?: string | null): void {
    const window = this._deps.getWindow()
    if (!window) return
    this._guardAgainstReload(window)

    // Without a bundle there is nothing local to show. A dev checkout that has
    // not run the workspace build falls back to the hosted app, so the rest of
    // the launcher can still be worked on. An installed app must not: the
    // hosted page is not the bundle's origin, so every This Computer action the
    // Workspace offers would fail without a word. Refuse, and let the renderer
    // say what is wrong.
    const local = bundleExists()
    if (!local && app.isPackaged) {
      slog("[workspace-view] installed app has no Workspace bundle — not showing the hosted app")
      throw new Error(WORKSPACE_BUNDLE_MISSING)
    }
    const view = this._ensureView()
    const url = target === null && this._url && !this._openHome
      ? this._url
      : local
        ? this._urlFor(this._openHome ? "" : target, token)
        : `${webBase(this._deps.endpoint())}/${encodeURIComponent(target || "")}`
    this._openHome = false
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

  /** Explicit account home navigation; reopening the app otherwise resumes. */
  openHome(): void {
    if (!this._view) { this._openHome = true; return }
    this._url = bundleExists() ? this._urlFor("") : `${webBase(this._deps.endpoint())}/`
    void this._view.webContents.loadURL(this._url).catch((err) =>
      slog(`[workspace-view] home failed: ${(err as Error).message}`),
    )
  }

  isWorkspaceSender(contents: Electron.WebContents): boolean {
    if (contents !== this._view?.webContents) return false
    const url = contents.getURL()
    return url.startsWith(`${WORKSPACE_SCHEME}://${WORKSPACE_HOST}/`)
  }

  /**
   * Tear the view down and forget everything that origin stored.
   *
   * Called whenever the account ends, however it ends: the injected session
   * and every per-account cache live in that origin's storage, so leaving them
   * would keep a signed-in workspace one click away from a launcher that
   * believes it signed the user out, and hand the next account this one's data.
   */
  async signOut(): Promise<void> {
    this.destroy()
    this._cleared = electronSession
      .fromPartition(WORKSPACE_PARTITION)
      .clearStorageData()
      .catch((err) => slog(`[workspace-view] clearing storage failed: ${(err as Error).message}`))
    await this._cleared
  }

  /**
   * Resolves once the last sign-out's storage wipe has finished. A view
   * created before then would have the session it was just given wiped.
   */
  whenCleared(): Promise<void> {
    return this._cleared
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
  private _urlFor(target: string | null, token?: string | null): string {
    if (target === null) return workspaceBundleUrl("/?desktop_resume=1")
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
    view.webContents.on("render-process-gone", (_e, details) => {
      slog(`[workspace-view] renderer gone: ${details.reason}`)
      // Left alone, a dead view stays a blank rectangle over the window — the
      // Workspace half simply turns white until the app restarts.
      if (details.reason === "clean-exit" || this._view !== view) return
      if (!this._shouldReloadView()) {
        slog("[workspace-view] renderer keeps crashing — not reloading it again")
        return
      }
      if (!view.webContents.isDestroyed()) view.webContents.reload()
    })
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
    this._view = view
    this.setBounds(this._bounds)
    return view
  }

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
  private _hardenNavigation(contents: Electron.WebContents): void {
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
