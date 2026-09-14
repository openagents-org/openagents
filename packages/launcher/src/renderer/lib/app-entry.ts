export type AppMode = "welcome" | "launcher" | "workspace"

const ENTRY_KEY = "openagents:last-area"

export function readAppEntry(signedIn: boolean): AppMode {
  try {
    const saved = localStorage.getItem(ENTRY_KEY)
    if (saved === "launcher" || saved === "workspace") return saved
  } catch { /* Storage can be unavailable on first launch. */ }
  return signedIn ? "workspace" : "welcome"
}

export function rememberAppEntry(mode: AppMode): void {
  try { localStorage.setItem(ENTRY_KEY, mode) } catch { /* Optional preference. */ }
}
