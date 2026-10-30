import { app, session as electronSession } from "electron"
import type { BrowserWindow, WebContentsView } from "electron"

import { apiBase, webBase } from "./auth/endpoints"
import {
  allowBundleApiAccess,
  bundleExists,
  workspaceBundleUrl,
  WORKSPACE_HOST,
  WORKSPACE_PARTITION,
  WORKSPACE_SCHEME,
} from "./workspace-bundle"
import { slog } from "./bootstrap/startup-log"
import { crashLoopGuard } from "./responsiveness"
import { createWorkspaceView } from "./workspace-view-factory"
import { duplicateOf, findTab, neighbourAfterClose, routeWorkspace, tabOrigin } from "./workspace-tabs"
import {
  WORKSPACE_BUNDLE_MISSING,
  WORKSPACE_HOME_TAB,
  shortcutTab,
  type WorkspaceTabsSnapshot,
  type WorkspaceTabState,
  type WorkspaceViewScope,
} from "../shared/workspace-view"

export { LAUNCHER_UA_TAG } from "./workspace-view-factory"

/**
 * The workspace, hosted by the main process.
 *
 * The workspace front end is a 45k-line client-side app that already exists and
 * already works; the desktop app carries it rather than reimplementing it. It
 * is BUILT INTO the installer (workspace/frontend's second, Vite build target)
 * and served off disk over a custom scheme. Its assets are local; workspace
 * data still comes from the configured API. See workspace-bundle.ts.
 *
 * It is drawn as WebContentsViews layered over the renderer, NOT <webview>
 * tags — those arrive with their own unreviewed webPreferences and the renderer
 * is explicitly barred from creating them (see web-security). A view owned by
 * main keeps every navigation and permission decision on this side.
 *
 * One view per open workspace, plus one for the All Workspaces page. Switching
 * tabs swaps which view is attached; the others stay loaded behind it, so each
 * workspace keeps its thread, scroll position and half-typed message. Closing a
 * tab is the only thing that discards a page.
 *
 * The renderer decides where it goes: it measures the region of its own layout
 * that the workspace should fill and sends those bounds over. That keeps the
 * tab strip, the window chrome and every launcher dialog above it in the
 * renderer's own DOM, with only the workspace pages themselves living out here.
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
  /** See WorkspaceViewOptions.onExternalLogin. */
  onExternalLogin: () => void
  /** The tab strip changed: opened, closed, switched, renamed or reloaded. */
  onTabsChanged?: (snapshot: WorkspaceTabsSnapshot) => void
}

/** A loaded page and what it is for. */
interface ViewEntry {
  /** WORKSPACE_HOME_TAB, or an opaque tab id. */
  id: string
  view: WebContentsView
  /** The deployment it was opened against. See TabIdentity. */
  origin: string
  /** The route segment it was opened on, and every name its page reported. */
  aliases: Set<string>
  workspaceId: string | null
  title: string
  slug: string | null
  /** True once the page has named itself; a caller's guess no longer applies. */
  named: boolean
  /** The device token it was opened with. Stays in main, never in a snapshot. */
  token: string | null
  /** What a reload, a retry or a stale view loads. */
  baseUrl: string
  state: WorkspaceTabState
  /** The launcher's own page reloaded since; load baseUrl when next shown. */
  stale: boolean
  /** Whether a crashed view should be reloaded. See responsiveness.ts. */
  shouldReload: () => boolean
}

export class WorkspaceHost {
  private _home: ViewEntry | null = null
  private _tabs: ViewEntry[] = []
  private _active: ViewEntry | null = null
  /** The entry whose view is in the window right now. */
  private _attached: ViewEntry | null = null
  /** Whether the renderer wants a workspace on screen (between show and hide). */
  private _visible = false
  /** The first All Workspaces load of a session resumes the last route. */
  private _resumed = false
  private _nextTab = 1
  private _bounds: ViewBounds = { x: 0, y: 0, width: 0, height: 0 }
  /** The window whose reloads are already being watched. See _guardAgainstReload. */
  private _guardedWindow: BrowserWindow | null = null
  /** The last sign-out's storage wipe. See whenCleared. */
  private _cleared: Promise<void> = Promise.resolve()

  constructor(private _deps: WorkspaceHostDeps) {
    // The bundle's origin is not one the API's CORS allowlist knows; this is
    // what lets it call the API at all. Set up once, before any view exists.
    allowBundleApiAccess(apiBase(_deps.endpoint()), webBase(_deps.endpoint()))
  }

  private get _entries(): ViewEntry[] {
    return this._home ? [this._home, ...this._tabs] : [...this._tabs]
  }

  /** Tell every hosted page the launcher's look and feel changed. */
  sendAppearance(next: { theme: string; locale: string }): void {
    for (const entry of this._entries) entry.view.webContents.send("workspace-view:appearance", next)
  }

  /** The session the preload asks for, synchronously, at page start. */
  currentSession(): EmbeddedSession | null {
    return this._deps.session()
  }

  /**
   * Hand every loaded page the account's renewed session, so they keep working
   * without a reload — a hidden tab included, or it would be signed out when
   * the user came back to it. A page loaded later picks it up from the preload.
   */
  sendSession(session: EmbeddedSession): void {
    for (const entry of this._entries) entry.view.webContents.send("workspace-view:session", session)
  }

  /**
   * Show a launcher notice inside the page. The view is drawn above the
   * launcher's own DOM, so a toast raised there cannot be seen while the view
   * is on screen — and when it is not, the launcher's own toast is visible and
   * this one is not needed.
   */
  sendNotice(notice: { message: string; type: string }): void {
    this._attached?.view.webContents.send("workspace-view:notice", notice)
  }

  /**
   * Ask All Workspaces to confirm a sign-out, in the page's own dialog: the
   * launcher's would be drawn under the view. False when that page is not the
   * one on screen and ready, so the launcher can ask in its own place instead.
   */
  requestSignOut(): boolean {
    const home = this._home
    if (!home || this._attached !== home || home.state !== "ready") return false
    home.view.webContents.send("workspace-view:request-sign-out")
    return true
  }

  /** The tab strip as the renderer draws it. */
  snapshot(): WorkspaceTabsSnapshot {
    return {
      active: this._active?.id ?? null,
      home: this._home?.state ?? null,
      tabs: this._tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        slug: tab.slug,
        state: tab.state,
      })),
    }
  }

  /**
   * Put the Workspace on screen at `bounds`.
   *
   * @param target workspace slug or id — the path the web app routes on. Its
   *   tab is opened, or brought forward if it is already open; null shows
   *   whichever page was showing last.
   * @param token the workspace's shared access token, when the caller has one.
   *   It grants nothing new: the page uses it exactly as a browser would from
   *   a shared link.
   * @param title what to call a new tab until its page names the workspace.
   */
  show(
    target: string | null,
    bounds: ViewBounds,
    token?: string | null,
    sessionId?: string | null,
    title?: string | null,
  ): void {
    const window = this._deps.getWindow()
    if (!window) return
    this._guardAgainstReload(window)

    // Without a bundle there is nothing local to show. A dev checkout that has
    // not run the workspace build falls back to the hosted app, so the rest of
    // the launcher can still be worked on. An installed app must not: the
    // hosted page is not the bundle's origin, so every This Computer action the
    // Workspace offers would fail without a word. Refuse, and let the renderer
    // say what is wrong.
    if (!bundleExists() && app.isPackaged) {
      slog("[workspace-view] installed app has no Workspace bundle — not showing the hosted app")
      throw new Error(WORKSPACE_BUNDLE_MISSING)
    }
    this._bounds = bounds
    if (target) this._active = this._openTab(target, token ?? null, sessionId ?? null, title ?? null)
    else if (!this._active) this._active = this._ensureHome(true)
    this._visible = true
    this._attachActive()
    this.setBounds(bounds)
    this._emit()
  }

  /** Bring a tab, or the All Workspaces page, forward. */
  activate(id: string): void {
    const entry = id === WORKSPACE_HOME_TAB ? this._ensureHome(false) : this._tabs.find((tab) => tab.id === id)
    if (!entry) return
    this._active = entry
    this._attachActive()
    this._emit()
  }

  /** Move a tab to `index` in the strip, as dragging it there does. */
  move(id: string, index: number): void {
    const from = this._tabs.findIndex((tab) => tab.id === id)
    if (from < 0 || !Number.isInteger(index)) return
    const to = Math.max(0, Math.min(index, this._tabs.length - 1))
    if (to === from) return
    const [entry] = this._tabs.splice(from, 1)
    this._tabs.splice(to, 0, entry)
    this._emit()
  }

  /**
   * Close one tab and discard its page. Only the view goes: the workspace,
   * this device's connection to it and its agents are untouched.
   */
  close(id: string): void {
    const entry = this._tabs.find((tab) => tab.id === id)
    if (!entry) return
    if (this._active === entry) {
      const next = neighbourAfterClose(this._tabs.map((tab) => tab.id), id)
      this._active = this._tabs.find((tab) => tab.id === next) ?? this._ensureHome(false)
    }
    this._tabs = this._tabs.filter((tab) => tab !== entry)
    this._discard(entry)
    this._attachActive()
    this._emit()
  }

  /**
   * Close several tabs at once — the context menu's "close other tabs",
   * "close tabs to the right" and "close all tabs". `keep` is the tab the
   * menu was opened on: it is brought forward when the one showing goes.
   */
  closeMany(ids: readonly string[], keep: string | null): void {
    const closing = this._tabs.filter((tab) => ids.includes(tab.id))
    if (!closing.length) return
    this._tabs = this._tabs.filter((tab) => !closing.includes(tab))
    if (this._active && closing.includes(this._active)) {
      this._active = this._tabs.find((tab) => tab.id === keep) ?? this._ensureHome(false)
    }
    for (const entry of closing) this._discard(entry)
    this._attachActive()
    this._emit()
  }

  /** Reload one tab's page where it is, as a browser's "Reload" does. */
  reloadTab(id: string): void {
    this._entries.find((entry) => entry.id === id)?.view.webContents.reload()
  }

  reload(): void {
    this._active?.view.webContents.reload()
  }

  /**
   * Start a page that failed over from the route it was opened on. Only that
   * tab: the others never stopped working.
   */
  retry(id: string): void {
    const entry = this._entries.find((candidate) => candidate.id === id)
    if (!entry) return
    this._load(entry, entry.baseUrl, true)
    this._attachActive()
    this._emit()
  }

  /** The All Workspaces page, at its list rather than wherever it was left. */
  openHome(): void {
    const existed = !!this._home
    const home = this._ensureHome(false)
    if (existed && home.view.webContents.getURL() !== home.baseUrl) this._load(home, home.baseUrl)
    this._active = home
    this._attachActive()
    this._emit()
  }

  /**
   * A page asked to go somewhere that is not its own: a workspace picked from
   * the All Workspaces list, another workspace chosen from inside one, or the
   * list itself. The route goes to the view that owns it, opening a tab when
   * no view does, so no page is ever navigated away from its own workspace.
   */
  openRoute(sender: Electron.WebContents, route: unknown): void {
    if (!this._entryFor(sender) || typeof route !== "string") return
    const workspace = routeWorkspace(route)
    if (workspace === undefined) return
    if (workspace === null) {
      this.activate(WORKSPACE_HOME_TAB)
      return
    }
    const existing = findTab(this._tabs, workspace, this._origin())
    if (existing) {
      // Its own root is just "bring it forward"; anywhere deeper it walks to
      // itself, in place, so the page it has open is not reloaded.
      if (route.split("?")[0].split("/").filter(Boolean).length > 1) {
        existing.view.webContents.send("workspace-view:navigate", route)
      }
      this._active = existing
    } else {
      this._active = this._createTab(workspace, null, null, this._bundleOr(route))
    }
    this._attachActive()
    this._emit()
  }

  /**
   * A workspace's page says which workspace it is. It gives the tab its real
   * name, makes it answer to both the slug and the id, and folds it into a tab
   * that was already showing the same workspace under its other name.
   */
  reportWorkspace(sender: Electron.WebContents, info: unknown): void {
    const entry = this._entryFor(sender)
    if (!entry || entry === this._home || !info || typeof info !== "object") return
    const { id, slug, name } = info as Record<string, unknown>
    const valid = (value: unknown): value is string => typeof value === "string" && !!value && value.length <= 200
    if (!valid(id)) return
    entry.workspaceId = id
    entry.aliases.add(id)
    if (valid(slug)) {
      entry.aliases.add(slug)
      entry.slug = slug
    }
    if (valid(name)) {
      entry.title = name
      entry.named = true
    }
    const original = duplicateOf(this._tabs, entry)
    if (original) {
      if (this._active === entry) this._active = original
      this._tabs = this._tabs.filter((tab) => tab !== entry)
      this._discard(entry)
      this._attachActive()
    }
    this._emit()
  }

  /** What the page in this view is, for its preload. Null for a stranger. */
  scopeFor(contents: Electron.WebContents): WorkspaceViewScope | null {
    const entry = this._entryFor(contents)
    if (!entry) return null
    return entry === this._home ? { kind: "home" } : { kind: "workspace", aliases: [...entry.aliases] }
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
      // The views have been navigating on their own since — the user opening
      // workspace settings, say. A page that broke there would stay broken
      // across every reload of the launcher, so each one starts over from the
      // route it was opened on the next time it is shown.
      for (const entry of this._entries) entry.stale = true
    })
  }

  setBounds(bounds: ViewBounds): void {
    this._bounds = bounds
    // Every view, not just the one on screen, so switching tabs never shows a
    // page laid out for a window size it no longer has.
    for (const entry of this._entries) this._applyBounds(entry.view)
  }

  /**
   * Take the workspace off screen without discarding it — every page keeps its
   * scroll position, its open channel and its event stream, so switching back
   * to it is instant rather than a fresh load.
   */
  hide(): void {
    this._visible = false
    this._detach()
  }

  isWorkspaceSender(contents: Electron.WebContents): boolean {
    if (!this._entryFor(contents)) return false
    return contents.getURL().startsWith(`${WORKSPACE_SCHEME}://${WORKSPACE_HOST}/`)
  }

  /**
   * Tear every view down and forget everything that origin stored.
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
    for (const entry of this._entries) this._discard(entry)
    this._home = null
    this._tabs = []
    this._active = null
    this._resumed = false
    this._emit()
  }

  private _origin(): string {
    return tabOrigin(webBase(this._deps.endpoint()))
  }

  private _entryFor(contents: Electron.WebContents): ViewEntry | undefined {
    return this._entries.find((entry) => entry.view.webContents === contents)
  }

  private _openTab(target: string, token: string | null, sessionId: string | null, title: string | null): ViewEntry {
    const existing = findTab(this._tabs, target, this._origin())
    if (!existing) return this._createTab(target, token, title, this._urlFor(target, token, sessionId))
    // A notification for a workspace already open has no need to carry its
    // access token through the notification centre: the tab kept its own.
    if (token && token !== existing.token) {
      existing.token = token
      existing.baseUrl = this._urlFor(target, token)
    }
    if (title && !existing.named) existing.title = title
    // A second click on the same notification should return to its thread even
    // if the user selected another one since the first click.
    if (sessionId) this._load(existing, this._urlFor(target, existing.token, sessionId))
    return existing
  }

  private _createTab(target: string, token: string | null, title: string | null, url: string): ViewEntry {
    const entry = this._createEntry(`tab-${this._nextTab++}`, this._urlFor(target, token))
    entry.aliases.add(target)
    entry.title = title || target
    entry.slug = target
    entry.token = token
    this._tabs.push(entry)
    this._load(entry, url)
    return entry
  }

  /**
   * The All Workspaces page, created on first use. The first one of a session
   * may resume where the user last was, which is how reopening the app lands
   * back in the workspace it was closed on.
   */
  private _ensureHome(resume: boolean): ViewEntry {
    if (this._home) return this._home
    const home = this._createEntry(WORKSPACE_HOME_TAB, this._bundleOr("/"))
    this._home = home
    this._load(home, resume && !this._resumed && bundleExists() ? workspaceBundleUrl("/?desktop_resume=1") : home.baseUrl)
    this._resumed = true
    return home
  }

  private _createEntry(id: string, baseUrl: string): ViewEntry {
    const view = createWorkspaceView({
      endpoint: this._deps.endpoint(),
      onExternalLogin: this._deps.onExternalLogin,
    })
    const entry: ViewEntry = {
      id, view, baseUrl,
      origin: this._origin(),
      aliases: new Set(),
      workspaceId: null,
      title: "",
      slug: null,
      named: false,
      token: null,
      state: "loading",
      stale: false,
      shouldReload: crashLoopGuard(),
    }
    this._watch(entry)
    this._applyBounds(view)
    return entry
  }

  /**
   * The tab shortcuts, for a key pressed while the page has focus — which is
   * most of the time in Workspace, and where the launcher's own window never
   * sees the key. The launcher's handler covers focus on the tab strip.
   */
  handleTabShortcut(input: Parameters<typeof shortcutTab>[0]): boolean {
    const id = shortcutTab(input, process.platform, this._tabs.map((tab) => tab.id))
    if (!id) return false
    this.activate(id)
    return true
  }

  /** Load state, crashes and dead ends, per view. */
  private _watch(entry: ViewEntry): void {
    const contents = entry.view.webContents
    contents.on("before-input-event", (event, input) => {
      if (this.handleTabShortcut(input)) event.preventDefault()
    })
    // Whatever goes wrong in here is invisible otherwise: the view has no
    // window chrome, and a page that fails to load looks exactly like one that
    // loaded and rendered nothing.
    contents.on("did-fail-load", (_e, code, description, validatedURL, isMainFrame) => {
      slog(`[workspace-view] did-fail-load ${code} ${description} — ${validatedURL}`)
      if (!isMainFrame) return
      // A page we shipped cannot fail to load; anything that does is somewhere
      // the sign-in took us, and the error page it leaves behind is a dead
      // end — no navigation, no way back, nothing on screen to explain it.
      // Returning to the bundle at least puts the user somewhere with exits.
      if (!validatedURL.startsWith(`${WORKSPACE_SCHEME}://${WORKSPACE_HOST}/`) && bundleExists()) {
        void contents.loadURL(entry.baseUrl).catch(() => {})
      }
    })
    contents.on("render-process-gone", (_e, details) => {
      slog(`[workspace-view] renderer gone: ${details.reason}`)
      // Left alone, a dead view stays a blank rectangle over the window — the
      // Workspace half simply turns white until the app restarts.
      if (details.reason === "clean-exit" || !this._entries.includes(entry)) return
      if (!entry.shouldReload()) {
        slog("[workspace-view] renderer keeps crashing — not reloading it again")
        this._fail(entry)
        return
      }
      if (!contents.isDestroyed()) contents.reload()
    })
  }

  private _load(entry: ViewEntry, url: string, retry = false): void {
    entry.stale = false
    if (retry || entry.state === "failed") entry.state = "loading"
    entry.view.webContents.loadURL(url).then(() => {
      if (entry.state === "ready" || !this._entries.includes(entry)) return
      entry.state = "ready"
      this._emit()
    }).catch((err: Error & { code?: string }) => {
      // Superseded by the next navigation — a thread link clicked while the
      // page was still loading — which reports its own outcome.
      if (err.code === "ERR_ABORTED" || !this._entries.includes(entry)) return
      slog(`[workspace-view] load failed: ${err.message}`)
      if (url.startsWith(`${WORKSPACE_SCHEME}://`)) this._fail(entry)
    })
  }

  /** Take a page that cannot show anything off screen, so its retry can be seen. */
  private _fail(entry: ViewEntry): void {
    entry.state = "failed"
    if (this._attached === entry) this._detach()
    this._emit()
  }

  /** Make the window show the active page, if the renderer wants one shown. */
  private _attachActive(): void {
    if (!this._visible) return
    const next = this._active && this._active.state !== "failed" ? this._active : null
    if (next?.stale) this._load(next, next.baseUrl)
    if (this._attached === next) return
    this._detach()
    if (!next) return
    this._deps.getWindow()?.contentView.addChildView(next.view)
    this._attached = next
  }

  private _detach(): void {
    if (!this._attached) return
    this._deps.getWindow()?.contentView.removeChildView(this._attached.view)
    this._attached = null
  }

  private _discard(entry: ViewEntry): void {
    if (this._attached === entry) this._detach()
    if (this._home === entry) this._home = null
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }

  private _applyBounds(view: WebContentsView): void {
    // Rounded, not truncated: fractional device pixels leave a hairline of the
    // page behind the view showing along one edge.
    view.setBounds({
      x: Math.round(this._bounds.x),
      y: Math.round(this._bounds.y),
      width: Math.max(0, Math.round(this._bounds.width)),
      height: Math.max(0, Math.round(this._bounds.height)),
    })
  }

  private _emit(): void {
    this._deps.onTabsChanged?.(this.snapshot())
  }

  /** A route inside the bundle, or on the hosted app when there is no bundle. */
  private _bundleOr(route: string): string {
    return bundleExists() ? workspaceBundleUrl(route) : `${webBase(this._deps.endpoint())}${route}`
  }

  /**
   * The URL for a workspace.
   *
   * Hash routing (see the bundle's desktop/router), so the token rides in the
   * hash query rather than the URL's: a workspace this device is paired to but
   * the account is not a member of still opens, with the device's own token,
   * exactly as a browser would from a shared link.
   */
  private _urlFor(target: string, token?: string | null, sessionId?: string | null): string {
    const route = `/${encodeURIComponent(target)}`
    if (!bundleExists()) return `${webBase(this._deps.endpoint())}${route}`
    const query = new URLSearchParams()
    if (token) query.set("token", token)
    if (sessionId) query.set("thread", sessionId)
    return workspaceBundleUrl(`${route}${query.size ? `?${query}` : ""}`)
  }
}
