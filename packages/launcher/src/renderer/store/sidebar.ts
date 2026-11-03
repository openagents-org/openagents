import { create } from "zustand"

const OPEN_KEY = "launcher:sidebar-open"

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "off"
  } catch {
    return true
  }
}

/**
 * Whether the sidebar is expanded — one state for the whole window, changed
 * only by the user (the header's toggle, ⌘/Ctrl+B, the rail) and remembered
 * across restarts.
 *
 * It used to be held per side, with the Workspace side always starting on the
 * icon rail. Once the open workspaces were listed in the sidebar, that meant
 * choosing one shrank the sidebar out from under the pointer, and going back
 * restored whatever the other side had last been — the sidebar seemed to open
 * and close on its own.
 *
 * The Settings entry opens and closes on its own; it starts closed so the
 * sidebar stays short.
 */
interface SidebarState {
  open: boolean
  settingsOpen: boolean
  /** The This Computer | Workspace switch's own width, in px, 0 until measured. */
  switchWidth: number
  setOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSwitchWidth: (width: number) => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  open: readOpen(),
  settingsOpen: false,
  switchWidth: 0,

  setOpen: (open) => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "on" : "off")
    } catch {}
    set({ open })
  },

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  setSwitchWidth: (switchWidth) => set((s) => (s.switchWidth === switchWidth ? s : { switchWidth })),
}))
