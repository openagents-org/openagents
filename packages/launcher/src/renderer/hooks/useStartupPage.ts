import { useEffect } from "react"

import { useUiStore } from "@renderer/store/ui"

/** Value of the `startupPage` setting that means "wherever I left off". */
export const STARTUP_PAGE_LAST = "last"

/** Pages offered in Settings → General → "Open on launch". */
export const STARTUP_PAGES = [
  "dashboard",
  "agents",
  "workspaces",
  "install",
  "logs",
] as const

const LAST_TAB_KEY = "launcher:last-tab"

/**
 * Applies Settings → General → "Open on launch", and keeps the "last used"
 * option supplied with a value.
 *
 * The setting arrives over async IPC, so a user who clicks the rail before it
 * resolves would otherwise get yanked away from the page they just chose —
 * hence the guard on the tab still being the untouched default.
 */
export function useStartupPage(): void {
  const currentTab = useUiStore((s) => s.currentTab)

  useEffect(() => {
    let cancelled = false
    void window.api
      .getSetting("startupPage")
      .then((value) => {
        if (cancelled) return
        const pref = typeof value === "string" ? value : "dashboard"
        if (!pref || pref === "dashboard") return
        if (useUiStore.getState().currentTab !== "dashboard") return

        let target = pref
        if (pref === STARTUP_PAGE_LAST) {
          try {
            target = localStorage.getItem(LAST_TAB_KEY) || "dashboard"
          } catch {
            target = "dashboard"
          }
        }
        if (target && target !== "dashboard") {
          useUiStore.getState().setCurrentTab(target)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(LAST_TAB_KEY, currentTab)
    } catch {}
  }, [currentTab])
}
