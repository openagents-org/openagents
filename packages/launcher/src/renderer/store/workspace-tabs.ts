import { create } from "zustand"

import type { WorkspaceTabsSnapshot } from "../../shared/workspace-view"
import { useAccountStore } from "./account"

/**
 * The Workspace tab strip, mirrored from main.
 *
 * Main owns the tabs because it owns the pages behind them: a tab is a live
 * view, and the renderer can reload without those going anywhere. This store
 * only holds the last snapshot and forwards what the user asked for.
 */
interface WorkspaceTabsState extends WorkspaceTabsSnapshot {
  init: () => void
  /** Bring a tab forward, switching to the Workspace side if needed. */
  activate: (id: string) => void
  close: (id: string) => void
  retry: (id: string) => void
}

const EMPTY: WorkspaceTabsSnapshot = { tabs: [], active: null, home: null }

let subscribed = false

export const useWorkspaceTabsStore = create<WorkspaceTabsState>((set) => ({
  ...EMPTY,

  init: () => {
    // A renderer hot reload can precede the Electron preload restart in dev.
    if (subscribed || !window.api.onWorkspaceTabsChanged) return
    subscribed = true
    window.api.onWorkspaceTabsChanged((snapshot) => set(snapshot))
    void window.api.getWorkspaceTabs().then((snapshot) => set(snapshot)).catch(() => {})
  },

  activate: (id) => {
    void window.api.activateWorkspaceTab(id)
    useAccountStore.getState().enterWorkspaceMode()
  },

  close: (id) => void window.api.closeWorkspaceTab(id),

  retry: (id) => void window.api.retryWorkspaceTab(id),
}))
