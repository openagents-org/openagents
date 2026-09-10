import { create } from "zustand"

import { showGlobalToast } from "../hooks/useToast"
import { capture } from "../lib/analytics"
import { accountError } from "../lib/account-errors"
import i18n from "../i18n"
import type { AccountInfo, AccountWorkspace } from "../types"

/**
 * The signed-in account and the workspaces it can reach.
 *
 * Deliberately separate from `store/workspaces`, which is the DEVICE scope —
 * the workspaces this machine is paired to, read from ~/.openagents/node.json.
 * The two lists answer different questions ("which workspaces am I in?" vs
 * "which workspaces may run agents here?") and are routinely different: being
 * a member does not authorize the machine, and a machine an admin authorized
 * may belong to a workspace the user is not in.
 *
 * Signing in is a gate on the workspace half of the app only. Nothing under My
 * Agents reads this store.
 */
/**
 * Which half of the app is on screen.
 *
 * The two are exclusive, not nested: a workspace gets the whole window, minus
 * the strip the window buttons live in. Sharing the window with the rail is
 * what made the workspace render its narrow-screen layout — a hamburger and a
 * bottom tab bar — because 936px is a phone as far as it is concerned.
 */
export type AppMode = "launcher" | "workspace"

interface AccountState {
  account: AccountInfo | null
  mode: AppMode
  /** The workspace currently open, or null. */
  active: AccountWorkspace | null
  /** False until the first read from main lands — not "no account". */
  ready: boolean
  signingIn: boolean
  workspaces: AccountWorkspace[]
  workspacesLoading: boolean
  /** Last failure, for the surface that asked. Cleared by the next attempt. */
  error: string | null
  setActive: (workspace: AccountWorkspace | null) => void
  /** Hand the window over to a workspace. */
  enterWorkspace: (workspace: AccountWorkspace) => void
  /** Give it back to the launcher. The workspace stays loaded. */
  exitWorkspace: () => void
  /** Switch to Workspace mode without opening one — the mode bar's tab. */
  enterWorkspaceMode: () => void
  init: () => Promise<void>
  /** Open the workspace, which shows its own sign-in gate when signed out. */
  openSignIn: () => void
  /** Abandon a sign-in that moved to the browser, freeing its loopback port. */
  cancelSignIn: () => void
  /** Sign in with an email and password, in the app. */
  signInWithPassword: (email: string, password: string) => Promise<void>
  /**
   * Sign in through the browser, for the providers that will not authenticate
   * inside an app window. Resolves false on failure, with the reason in
   * `error` — the caller decides where to show it.
   */
  signIn: () => Promise<boolean>
  signOut: () => Promise<void>
  refreshWorkspaces: () => Promise<void>
  clearError: () => void
}

export const useAccountStore = create<AccountState>((set, get) => ({
  account: null,
  mode: "launcher",
  active: null,
  ready: false,
  signingIn: false,
  workspaces: [],
  workspacesLoading: false,
  error: null,

  setActive: (active) => set({ active }),

  enterWorkspace: (workspace) => {
    capture("workspace_entered", { role: workspace.role })
    set({ active: workspace, mode: "workspace" })
  },

  // The view is only hidden, never destroyed: coming back should be instant,
  // with the workspace's scroll position, open channel and event stream intact.
  exitWorkspace: () => set({ mode: "launcher" }),

  /**
   * The Workspace half of the app, at whatever it was last showing.
   *
   * `active` is deliberately untouched: coming back to the mode should land on
   * the workspace the user left open, and only a sign-out or an explicit "all
   * workspaces" clears it.
   */
  enterWorkspaceMode: () => set({ mode: "workspace", error: null }),

  /**
   * Show the sign-in.
   *
   * The Workspace side with no account IS the sign-in, so this is the mode
   * switch with the selection cleared. Nothing in the UI calls it any more —
   * the mode bar's tab does the same thing — but it stays as the one named way
   * to demand a sign-in, for a caller that needs one before it can continue.
   */
  openSignIn: () => {
    set({ active: null, mode: "workspace", error: null })
  },

  init: async () => {
    // Main owns the session, so it also owns every change to it: an expiry it
    // discovers mid-request has to reach the UI without the UI asking.
    window.api.onAccountChanged((account) => {
      set(() =>
        account
          ? // Nowhere to send them: a sign-in happens on the Workspace side and
            // finishes there, where an account with nothing open IS the list of
            // workspaces. See pages/workspace.
            { account, signingIn: false }
          : // `mode` deliberately untouched. Losing the account empties the
            // Workspace side back to its sign-in, which is where someone who
            // just signed out is looking; moving them to My Agents would answer
            // "sign out" with "here is a different part of the app". A session
            // that expires while they are on the My Agents side leaves them
            // exactly where they were, which is equally right — that half never
            // needed the account.
            {
              account: null,
              workspaces: [],
              active: null,
              signingIn: false,
            },
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
      void get().refreshWorkspaces()
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
    void get().refreshWorkspaces()
  },

  signOut: async () => {
    try {
      await window.api.signOut()
    } catch (err) {
      console.error("signOut failed:", err)
    }
    // Same reasoning as the listener above: stay on this side, where an
    // account-less Workspace IS the sign-in.
    set({ account: null, workspaces: [], active: null, error: null })
  },

  refreshWorkspaces: async () => {
    if (!get().account || get().workspacesLoading) return
    set({ workspacesLoading: true, error: null })
    try {
      set({ workspaces: (await window.api.listAccountWorkspaces()) ?? [] })
    } catch (err) {
      set({ error: (err as Error).message })
    } finally {
      set({ workspacesLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
