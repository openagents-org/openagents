import { create } from "zustand"
import { useUiStore } from "./ui"

import { showGlobalToast } from "../hooks/useToast"
import { accountError } from "../lib/account-errors"
import i18n from "../i18n"
import type { AccountInfo } from "../types"
import { readAppEntry, rememberAppEntry, type AppMode } from "../lib/app-entry"

/**
 * Desktop account and entry navigation. Workspace membership and its UI are
 * owned by the shared web app; local machine connections live in store/workspaces.
 * Signing in never gates the local tools in This Computer.
 */
export type { AppMode } from "../lib/app-entry"

/** A workspace to open on the Workspace side, asked for from outside it. */
export interface WorkspaceTarget {
  slug: string
  /**
   * This device's access token for it, so a workspace the account is not a
   * member of still opens — exactly as a shared link would.
   */
  token: string | null
}

interface AccountState {
  account: AccountInfo | null
  mode: AppMode
  /** What the Workspace side shows while signed out. */
  authMode: "welcome" | "sign-in" | "sign-up"
  /** Loaded by the next Workspace show, then cleared. See openWorkspace. */
  workspaceTarget: WorkspaceTarget | null
  /** Bumped per openWorkspace, so a target asked for while Workspace is showing still loads. */
  workspaceTargetSignal: number
  /** False until the first read from main lands — not "no account". */
  ready: boolean
  signingIn: boolean
  /** Last failure, for the surface that asked. Cleared by the next attempt. */
  error: string | null
  /**
   * Give it back to the launcher. The workspace stays loaded. Without a tab,
   * This Computer reopens wherever the user last left it.
   */
  exitWorkspace: (tab?: string) => void
  /** Resume the shared Workspace page. */
  enterWorkspaceMode: () => void
  openWorkspaces: () => void
  /** Open one workspace in the app's own Workspace. */
  openWorkspace: (target: WorkspaceTarget) => void
  clearWorkspaceTarget: () => void
  showWelcome: () => void
  init: () => Promise<void>
  /** Open the workspace, which shows its own sign-in gate when signed out. */
  openSignIn: () => void
  openSignUp: () => void
  /** Abandon a sign-in that moved to the browser, freeing its loopback port. */
  cancelSignIn: () => void
  /** Sign in with an email and password, in the app. */
  signInWithPassword: (email: string, password: string) => Promise<void>
  signUpWithPassword: (email: string, password: string, displayName?: string) => Promise<void>
  /**
   * Sign in through the browser, for the providers that will not authenticate
   * inside an app window. Resolves false on failure, with the reason in
   * `error` — the caller decides where to show it.
   */
  signIn: () => Promise<boolean>
  signOut: () => Promise<void>
  clearError: () => void
}

export const useAccountStore = create<AccountState>((set, get) => ({
  account: null,
  mode: "workspace",
  authMode: "welcome",
  workspaceTarget: null,
  workspaceTargetSignal: 0,
  ready: false,
  signingIn: false,
  error: null,

  // The view is only hidden, never destroyed: coming back should be instant,
  // with the workspace's scroll position, open channel and event stream intact.
  exitWorkspace: (tab) => {
    if (tab) useUiStore.getState().setCurrentTab(tab)
    rememberAppEntry("launcher")
    set({ mode: "launcher" })
  },

  // A null target resumes the page already loaded by the web app.
  enterWorkspaceMode: () => {
    rememberAppEntry("workspace")
    set({ mode: "workspace", error: null })
  },

  openWorkspaces: () => {
    void window.api.openWorkspaceHome()
    get().enterWorkspaceMode()
  },

  openWorkspace: (target) => {
    set((s) => ({ workspaceTarget: target, workspaceTargetSignal: s.workspaceTargetSignal + 1 }))
    get().enterWorkspaceMode()
  },

  clearWorkspaceTarget: () => set({ workspaceTarget: null }),

  showWelcome: () => {
    get().enterWorkspaceMode()
    set({ authMode: "welcome" })
  },

  openSignIn: () => {
    get().enterWorkspaceMode()
    set({ authMode: "sign-in" })
  },

  openSignUp: () => {
    get().enterWorkspaceMode()
    set({ authMode: "sign-up" })
  },

  init: async () => {
    set({ mode: readAppEntry() })
    // A renderer hot reload can precede the Electron preload restart in dev.
    // The new navigation bridge must not prevent account initialization.
    window.api.onWorkspaceAction?.((action) => {
      if (action === "computer") get().exitWorkspace()
      else get().openSignIn()
    })
    // Main owns the session, so it also owns every change to it: an expiry it
    // discovers mid-request has to reach the UI without the UI asking.
    window.api.onAccountChanged((account) => {
      // Keep the current area on sign-out: Workspace displays its sign-in
      // page, while local tools remain available without an account.
      set(account
        ? { account, signingIn: false }
        : { account: null, signingIn: false, authMode: "sign-in" },
      )
    })
    // Google and GitHub sign-ins leave the app; the window itself does not
    // change, so this is the only thing that says where they went.
    window.api.onSignInExternal(() => {
      set({ signingIn: true })
      showGlobalToast(i18n.t("account.externalOpened"), "info")
    })
    window.api.onSignInFailed(({ message }) => {
      set({ signingIn: false })
      showGlobalToast(accountError(message, i18n.t.bind(i18n)), "error")
    })
    try {
      set({ account: await window.api.getAccount() })
    } catch (err) {
      console.error("getAccount failed:", err)
    } finally {
      set({ ready: true })
    }
  },

  cancelSignIn: () => {
    void window.api.cancelSignIn()
    set({ signingIn: false })
  },

  signIn: async () => {
    if (get().signingIn) return false
    set({ signingIn: true, error: null })
    try {
      set({ account: await window.api.signIn() })
      return true
    } catch (err) {
      set({ error: (err as Error).message })
      return false
    } finally {
      set({ signingIn: false })
    }
  },

  signInWithPassword: async (email, password) => {
    const account = await window.api.signInWithPassword(email, password)
    set({ account, error: null })
  },

  signUpWithPassword: async (email, password, displayName) => {
    const account = await window.api.signUpWithPassword(email, password, displayName)
    set({ account, authMode: "sign-in", error: null })
  },

  signOut: async () => {
    try {
      await window.api.signOut()
    } catch (err) {
      console.error("signOut failed:", err)
    }
    // Same reasoning as the listener above: stay on this side, where an
    // account-less Workspace IS the sign-in.
    set({ account: null, authMode: "sign-in", error: null })
  },

  clearError: () => set({ error: null }),
}))
