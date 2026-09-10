import { ipcMain, type BrowserWindow } from "electron"

import {
  isThemeMode,
  toLauncherLanguage,
  toWorkspaceLocale,
  type ThemeMode,
} from "../../shared/appearance-bridge"

import { openExternalSafely } from "../web-security"
import { WorkspaceHost, type ViewBounds } from "../workspace-host"
import { AccountManager, type AccountWorkspace } from "./account"
import type { AccountInfo } from "./session-store"

/**
 * The account's IPC surface, kept out of index.ts.
 *
 * Every channel here is workspace-scoped: nothing under My Agents calls into
 * it, so a machine that never signs in never reaches this file.
 */

export interface AccountIpcDeps {
  /**
   * The look and feel the launcher is currently in, and a way to change it.
   * The hosted workspace shares both — see shared/appearance-bridge.
   */
  appearance: () => { theme: ThemeMode; language: string }
  setAppearance: (next: { theme?: ThemeMode; language?: string }) => void
  /** The configured workspace endpoint (store `workspaceEndpoint`), normalized. */
  endpoint: () => string | undefined
  /** The window to notify when the account changes; null before it exists. */
  getWindow: () => BrowserWindow | null
  /**
   * Redeem a pairing code (agentManager.connectNode). Injected because the
   * account has no business knowing about the agent core, and because the core
   * may still be loading when the renderer asks.
   */
  connectNode: (code: string) => Promise<unknown>
}

export function registerAccountIpc(deps: AccountIpcDeps): AccountManager {
  const account = new AccountManager({
    endpoint: deps.endpoint,
    openExternal: (url) => void openExternalSafely(url),
    onChange: (info: AccountInfo | null) => {
      deps.getWindow()?.webContents.send("account:changed", info)
    },
  })

  const host = new WorkspaceHost({
    getWindow: deps.getWindow,
    endpoint: deps.endpoint,
    session: () => account.embeddedSession(),
    // The in-app sign-in happens on the account site's own page; this is how
    // its result becomes the launcher's session too.
    onSession: (session) => account.adoptSession(session),
    // Google and GitHub cannot finish in the app, so their sign-in runs in the
    // browser and comes back over loopback — the same flow the launcher used
    // before any of this was embedded.
    onExternalLogin: () => {
      // The page in the view does not change, so without this the window looks
      // as if the click did nothing while the browser opens behind it.
      deps.getWindow()?.webContents.send("account:sign-in-external")
      void account.signIn().catch((err) => {
        deps.getWindow()?.webContents.send("account:sign-in-failed", {
          message: (err as Error).message,
        })
      })
    },
  })

  ipcMain.handle("account:get", () => account.getAccount())
  ipcMain.handle("account:sign-in", () => account.signIn())
  ipcMain.handle(
    "account:sign-in-password",
    (_e, email: string, password: string) =>
      account.signInWithPassword(String(email || ""), String(password || "")),
  )
  ipcMain.handle("account:cancel-sign-in", () => account.cancelSignIn())
  ipcMain.handle("account:sign-out", async () => {
    account.signOut()
    // The workspace page holds the session in its own origin's storage; a
    // sign-out that left it there would keep a signed-in workspace behind a
    // signed-out launcher.
    await host.signOut()
  })
  ipcMain.handle("account:workspaces", () => account.listWorkspaces())

  /**
   * "Authorize this machine" — the one click that replaces carrying a pairing
   * code from the browser by hand. Two existing calls, back to back: mint a
   * code as the signed-in admin, then redeem it as this device. Neither side
   * gained an endpoint, and the meaning is unchanged — a workspace still
   * authorizes a device, the user just stops being the courier.
   */
  ipcMain.handle("account:authorize-device", async (_e, workspaceId: string) => {
    const code = await account.createPairingCode(String(workspaceId || ""))
    return deps.connectNode(code)
  })

  // ── The embedded workspace view ──────────────────────────────────────────
  // The renderer owns the layout and tells main which rectangle of it the
  // workspace fills; main owns the page. See workspace-host.ts.

  ipcMain.handle(
    "workspace-view:show",
    async (
      _e,
      target: string,
      bounds: ViewBounds,
      token?: string | null,
    ) => {
      // Renew before the page reads the session: the preload plants whatever
      // is current, synchronously, and a token that lapses an hour into the
      // session would otherwise land the user on the web app's sign-in gate.
      if (account.getAccount()) await account.bearer().catch(() => null)
      host.show(String(target || ""), bounds, token ?? null)
    },
  )
  ipcMain.handle("workspace-view:set-bounds", (_e, bounds: ViewBounds) =>
    host.setBounds(bounds),
  )
  ipcMain.handle("workspace-view:hide", () => host.hide())
  ipcMain.handle("workspace-view:reload", () => host.reload())
  // The workspace signs people in on its own pages; this is how that reaches
  // the launcher's own account state. See the preload.
  ipcMain.on("workspace-view:session-changed", (_e, session) => {
    account.adoptSession(session ?? null)
  })
  // Synchronous by necessity — see the preload.
  ipcMain.on("workspace-view:config", (event) => {
    const { theme, language } = deps.appearance()
    event.returnValue = {
      session: host.currentSession(),
      apiUrl: deps.endpoint(),
      theme,
      locale: toWorkspaceLocale(language),
    }
  })

  // Changed inside the workspace — the launcher follows, so a choice made on
  // either side holds for the whole window.
  ipcMain.on("workspace-view:theme-changed", (_e, theme: unknown) => {
    if (isThemeMode(theme)) deps.setAppearance({ theme })
  })
  ipcMain.on("workspace-view:locale-changed", (_e, locale: unknown) => {
    deps.setAppearance({ language: toLauncherLanguage(String(locale || "")) })
  })

  // Changed in the launcher — the workspace follows.
  ipcMain.handle(
    "workspace-view:appearance",
    (_e, next: { theme: ThemeMode; language: string }) => {
      host.sendAppearance({
        theme: next.theme,
        locale: toWorkspaceLocale(next.language),
      })
    },
  )

  return account
}

export type { AccountWorkspace }
