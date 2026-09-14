/**
 * The two halves of the window. Signed out, the Workspace half shows Welcome
 * and sign-in; there is no third place to be.
 */
export type AppMode = "launcher" | "workspace"

const ENTRY_KEY = "openagents:last-area"
const DEVICE_ONLY_KEY = "openagents:device-only"

/** Workspace, unless This Computer was last used or the computer is device-only. */
export function readAppEntry(): AppMode {
  if (readDeviceOnly()) return "launcher"
  try {
    if (localStorage.getItem(ENTRY_KEY) === "launcher") return "launcher"
  } catch { /* Storage can be unavailable on first launch. */ }
  return "workspace"
}

export function rememberAppEntry(mode: AppMode): void {
  try { localStorage.setItem(ENTRY_KEY, mode) } catch { /* Optional preference. */ }
}

/**
 * Whether this computer only serves workspaces as a device — a server, a shared
 * machine — so the Workspace half of the window stays out of the way.
 */
export function readDeviceOnly(): boolean {
  try { return localStorage.getItem(DEVICE_ONLY_KEY) === "1" } catch { return false }
}

export function rememberDeviceOnly(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEVICE_ONLY_KEY, "1")
    else localStorage.removeItem(DEVICE_ONLY_KEY)
  } catch { /* Optional preference. */ }
}
