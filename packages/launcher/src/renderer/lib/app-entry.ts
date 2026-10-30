/**
 * The two halves of the window. Signed out, the Workspace half shows Welcome
 * and sign-in; there is no third place to be.
 */
export type AppMode = "launcher" | "workspace"

const ENTRY_KEY = "openagents:last-area"

/** Workspace, unless This Computer was last used. */
export function readAppEntry(): AppMode {
  try {
    if (localStorage.getItem(ENTRY_KEY) === "launcher") return "launcher"
  } catch { /* Storage can be unavailable on first launch. */ }
  return "workspace"
}

export function rememberAppEntry(mode: AppMode): void {
  try { localStorage.setItem(ENTRY_KEY, mode) } catch { /* Optional preference. */ }
}
