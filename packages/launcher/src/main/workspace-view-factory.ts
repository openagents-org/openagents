import path from "path"
import { app, WebContentsView } from "electron"

import { loginBase, webBase } from "./auth/endpoints"
import { WORKSPACE_HOST, WORKSPACE_PARTITION, WORKSPACE_SCHEME } from "./workspace-bundle"
import { openExternalSafely } from "./web-security"
import { slog } from "./bootstrap/startup-log"

/**
 * Marks this view as the desktop app, for the pages that need to know.
 *
 * The workspace's login callback reads it: a sign-in happening in here has to
 * be exchanged for a workspace session server-side, because a Firebase session
 * lives in the page and the launcher cannot keep one.
 */
export const LAUNCHER_UA_TAG = "OpenAgentsLauncher"

export interface WorkspaceViewOptions {
  /** The configured workspace endpoint, if any. */
  endpoint: string | undefined
  /**
   * Called when the sign-in has to leave the app: Google's and GitHub's OAuth
   * screens refuse to run in an embedded view, so those accounts finish in a
   * real browser and are handed back over loopback.
   */
  onExternalLogin: () => void
}

/**
 * One view for the hosted workspace, with everything every such view shares:
 * the isolated session, the preload, the user agent and the navigation rules.
 * What a view is FOR — which workspace, its load state — is workspace-host's.
 */
export function createWorkspaceView(options: WorkspaceViewOptions): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "../preload/workspace-view.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep Workspace discovery polling alive while the user is in This Computer,
      // another tab or another app, so agent replies can still reach OS notifications.
      backgroundThrottling: false,
      partition: WORKSPACE_PARTITION,
    },
  })
  view.setBackgroundColor("#00000000")
  // Identifies the desktop app to our own pages. Appended, so everything the
  // sites already branch on (platform, engine) still reads true.
  view.webContents.setUserAgent(
    `${view.webContents.getUserAgent()} ${LAUNCHER_UA_TAG}/${app.getVersion()}`,
  )
  hardenNavigation(view.webContents, options)
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
  return view
}

/** Whether the view currently sits on the account site's sign-in. */
function onLoginPage(contents: Electron.WebContents): boolean {
  try {
    return new URL(contents.getURL() || "").origin === new URL(loginBase()).origin
  } catch {
    return false
  }
}

/**
 * Move a sign-in that cannot finish here out to the browser, and put the page
 * back the way it was.
 *
 * The reload is the point of this being a function. A provider button opens a
 * popup and then waits for it to report back; refusing the popup leaves the
 * page waiting forever, with every button stuck on "Signing in…" and no way
 * for the user to pick a different method.
 */
function handOffToBrowser(contents: Electron.WebContents, options: WorkspaceViewOptions): void {
  slog("[workspace-view] sign-in needs a real browser — restarting it there")
  options.onExternalLogin()
  contents.reload()
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
function hardenNavigation(contents: Electron.WebContents, options: WorkspaceViewOptions): void {
  const allowed = [
    // The bundle itself.
    `${WORKSPACE_SCHEME}://${WORKSPACE_HOST}`,
    // The account site, for the sign-in that still runs on its own pages.
    new URL(loginBase()).origin,
    // The hosted workspace, for a deployment with no bundle to serve.
    new URL(webBase(options.endpoint)).origin,
  ]

  contents.setWindowOpenHandler(({ url }) => {
    // Same reasoning as will-navigate: a provider popup opened from the login
    // page is that provider refusing to run in here.
    if (onLoginPage(contents)) handOffToBrowser(contents, options)
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
    if (onLoginPage(contents)) {
      handOffToBrowser(contents, options)
      return
    }
    openExternalSafely(url)
  })
  contents.on("will-attach-webview", (event) => event.preventDefault())
}
