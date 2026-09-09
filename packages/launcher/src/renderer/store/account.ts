import { create } from 'zustand'

import { useUiStore } from './ui'
import { showGlobalToast } from '../hooks/useToast'
import { accountError } from '../lib/account-errors'
import i18n from '../i18n'
import type { AccountInfo, AccountWorkspace } from '../types'

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
interface AccountState {
  account: AccountInfo | null
  /** The workspace currently open in the embedded view, or null. */
  active: AccountWorkspace | null
  /** False until the first read from main lands — not "no account". */
  ready: boolean
  signingIn: boolean
  workspaces: AccountWorkspace[]
  workspacesLoading: boolean
  /** Last failure, for the surface that asked. Cleared by the next attempt. */
  error: string | null
  setActive: (workspace: AccountWorkspace | null) => void
  init: () => Promise<void>
  /** Open the workspace, which shows its own sign-in gate when signed out. */
  openSignIn: () => void
  /** Abandon a sign-in that moved to the browser, freeing its loopback port. */
  cancelSignIn: () => void
  signOut: () => Promise<void>
  refreshWorkspaces: () => Promise<void>
  clearError: () => void
}

export const useAccountStore = create<AccountState>((set, get) => ({
  account: null,
  active: null,
  ready: false,
  signingIn: false,
  workspaces: [],
  workspacesLoading: false,
  error: null,

  setActive: (active) => set({ active }),

  openSignIn: () => {
    // Signing in IS the workspace with nothing selected: its home is the
    // membership list when signed in and the sign-in gate when not, and either
    // way the session ends up in the page main reads it from.
    set({ active: null, error: null })
    useUiStore.getState().setCurrentTab("workspace")
  },

  init: async () => {
    // Main owns the session, so it also owns every change to it: an expiry it
    // discovers mid-request has to reach the UI without the UI asking.
    window.api.onAccountChanged((account) => {
      set(
        account
          ? { account, signingIn: false }
          : { account: null, workspaces: [], active: null, signingIn: false },
      )
    })
    // Google and GitHub sign-ins leave the app; the window itself does not
    // change, so this is the only thing that says where they went.
    window.api.onSignInExternal(() => {
      set({ signingIn: true })
      showGlobalToast(i18n.t('account.externalOpened'), 'info')
    })
    window.api.onSignInFailed(({ message }) => {
      set({ signingIn: false })
      showGlobalToast(accountError(message, i18n.t.bind(i18n)), 'error')
    })
    try {
      set({ account: await window.api.getAccount() })
    } catch (err) {
      console.error('getAccount failed:', err)
    } finally {
      set({ ready: true })
    }
  },

  cancelSignIn: () => {
    void window.api.cancelSignIn()
    set({ signingIn: false })
  },

  signOut: async () => {
    try {
      await window.api.signOut()
    } catch (err) {
      console.error('signOut failed:', err)
    }
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
