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
import { webBase } from "./endpoints"
import type { AccountInfo } from "./session-store"
import type { NodeStatus } from "../agent-manager"

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
  connectNode: (code: string) => Promise<NodeStatus & { warning: string | null }>
  nodeStatus: () => Promise<NodeStatus>
}

const NOTICE_TYPES = new Set(["info", "success", "error", "warning"])

export function registerAccountIpc(deps: AccountIpcDeps): AccountManager {
  let workspaceHost: WorkspaceHost | null = null
  let viewRequest = 0
  const account = new AccountManager({
    endpoint: deps.endpoint,
    openExternal: (url) => void openExternalSafely(url),
    onChange: (info: AccountInfo | null) => {
      if (!info) {
        // Every way an account ends — signed out here or from the page,
        // expired, refused on renewal — ends the same way: the live page goes
        // and its storage is wiped, so a stale page cannot be reused and the
        // next account inherits nothing of this one's.
        viewRequest++
        void workspaceHost?.signOut()
      } else {
        // A renewal: the loaded page keeps running on the new token.
        const session = account.embeddedSession()
        if (session) workspaceHost?.sendSession(session)
      }
      deps.getWindow()?.webContents.send("account:changed", info)
    },
  })

  const host = new WorkspaceHost({
    getWindow: deps.getWindow,
    endpoint: deps.endpoint,
    session: () => account.embeddedSession(),
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

  workspaceHost = host

  ipcMain.handle("account:get", () => account.getAccount())
  ipcMain.handle("account:sign-in", () => account.signIn())
  ipcMain.handle(
    "account:sign-in-password",
    (_e, email: string, password: string) =>
      account.signInWithPassword(String(email || ""), String(password || "")),
  )
  ipcMain.handle("account:cancel-sign-in", () => account.cancelSignIn())
  ipcMain.handle(
    "account:sign-up-password",
    (_e, email: string, password: string, displayName?: string) =>
      account.signUpWithPassword(String(email || ""), String(password || ""), String(displayName || "")),
  )
  ipcMain.handle("account:sign-out", async () => {
    // onChange tears the page down; resolve once its storage is gone too.
    account.signOut()
    await host.whenCleared()
  })
  ipcMain.handle("account:workspaces", () => account.listWorkspaces())

  // ── The embedded workspace view ──────────────────────────────────────────
  // The renderer owns the layout and tells main which rectangle of it the
  // workspace fills; main owns the page. See workspace-host.ts.

  ipcMain.handle(
    "workspace-view:show",
    async (
      _e,
      target: string | null,
      bounds: ViewBounds,
      token?: string | null,
    ) => {
      const request = ++viewRequest
      // Renew before the page reads the session: the preload plants whatever
      // is current, synchronously, and a token that lapses an hour into the
      // session would otherwise land the user on the web app's sign-in gate.
      if (account.getAccount()) await account.bearer().catch(() => null)
      // A view created while the last sign-out is still wiping storage would
      // lose the session it was just given.
      await host.whenCleared()
      // Switching to local tools or signing out during refresh cancels this
      // request, so a delayed result cannot put a native view over that page.
      if (request !== viewRequest) return
      host.show(target === null ? null : String(target || ""), bounds, token ?? null)
    },
  )
  ipcMain.handle("workspace-view:set-bounds", (_e, bounds: ViewBounds) =>
    host.setBounds(bounds),
  )
  ipcMain.handle("workspace-view:hide", () => {
    viewRequest++
    host.hide()
  })
  ipcMain.handle("workspace-view:reload", () => host.reload())
  ipcMain.handle("workspace-view:home", () => host.openHome())
  // The launcher's toasts are drawn under the view; repeat them inside it.
  ipcMain.handle("workspace-view:notice", (_e, notice: unknown) => {
    const { message, type } = (notice ?? {}) as { message?: unknown; type?: unknown }
    if (typeof message !== "string" || !message || typeof type !== "string" || !NOTICE_TYPES.has(type)) return
    host.sendNotice({ message: message.slice(0, 1000), type })
  })
  // The page asks for a sign-in only when its session no longer works, so the
  // account behind it is ended first and the native sign-in takes over.
  ipcMain.on("workspace-view:sign-in", (event) => {
    if (!host.isWorkspaceSender(event.sender)) return
    account.signOut()
    deps.getWindow()?.webContents.send("workspace:sign-in")
  })
  ipcMain.on("workspace-view:sign-out", (event) => {
    if (host.isWorkspaceSender(event.sender)) account.signOut()
  })
  ipcMain.on("workspace-view:open-computer", (event) => {
    if (host.isWorkspaceSender(event.sender)) deps.getWindow()?.webContents.send("workspace:open-computer")
  })
  const validateComputerRequest = (event: { sender: Electron.WebContents }, workspaceId: unknown): string => {
    if (!host.isWorkspaceSender(event.sender) || typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 200) {
      throw new Error("Invalid workspace connection request")
    }
    return workspaceId
  }
  // Return only this workspace's device id and basic display information.
  // Credentials and the computer's other workspace registrations stay in main.
  const computerInfo = (status: NodeStatus, workspaceId: string, warning = false) => ({
    hostname: status.hostname,
    deviceType: status.deviceType,
    nodeId: status.workspaces.find((entry) => entry.workspaceId === workspaceId)?.nodeId ?? null,
    warning,
  })
  ipcMain.handle("workspace-view:computer-status", async (event, workspaceId: unknown) => {
    const id = validateComputerRequest(event, workspaceId)
    return computerInfo(await deps.nodeStatus(), id)
  })
  const connections = new Map<string, Promise<ReturnType<typeof computerInfo>>>()
  ipcMain.handle("workspace-view:connect-computer", async (event, workspaceId: unknown) => {
    const id = validateComputerRequest(event, workspaceId)
    const pending = connections.get(id)
    if (pending) return pending
    const connecting = (async () => {
      const current = computerInfo(await deps.nodeStatus(), id)
      if (current.nodeId) return current
      const code = await account.createPairingCode(id)
      const result = await deps.connectNode(code)
      return computerInfo(result, id, !!result.warning)
    })()
    connections.set(id, connecting)
    try { return await connecting }
    finally { connections.delete(id) }
  })
  // Synchronous by necessity — see the preload.
  ipcMain.on("workspace-view:config", (event) => {
    const { theme, language } = deps.appearance()
    event.returnValue = {
      session: host.currentSession(),
      apiUrl: deps.endpoint(),
      webUrl: webBase(deps.endpoint()),
      theme,
      locale: toWorkspaceLocale(language),
    }
  })

  // Changed inside the workspace — the launcher follows, so a choice made on
  // either side holds for the whole window. Only from the page this host owns,
  // like every other request the page makes.
  ipcMain.on("workspace-view:theme-changed", (event, theme: unknown) => {
    if (!host.isWorkspaceSender(event.sender) || !isThemeMode(theme)) return
    deps.setAppearance({ theme })
  })
  ipcMain.on("workspace-view:locale-changed", (event, locale: unknown) => {
    if (!host.isWorkspaceSender(event.sender) || typeof locale !== "string" || !locale) return
    deps.setAppearance({ language: toLauncherLanguage(locale) })
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
