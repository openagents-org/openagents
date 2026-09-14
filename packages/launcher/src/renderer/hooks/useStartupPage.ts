import { useEffect, useState } from "react"
import { useUiStore } from "@renderer/store/ui"

export const STARTUP_PAGE_LAST = "last"
export const STARTUP_PAGES = ["dashboard", "install", "workspaces", "logs"] as const
const LAST_TAB_KEY = "launcher:last-tab"
const LOCAL_PAGES = [...STARTUP_PAGES, "connections", "credentials", "github", "settings"]

/**
 * A page This Computer can open on. Anything else — including the retired
 * Agents page, whose agents now live on This Computer — opens This Computer.
 */
function localPage(value: unknown): string {
  return typeof value === "string" && LOCAL_PAGES.includes(value) ? value : "dashboard"
}

function readLastTab(): string {
  try { return localPage(localStorage.getItem(LAST_TAB_KEY)) } catch { return "dashboard" }
}

/** Restores the local area without overwriting its saved tab during async startup. */
export function useStartupPage(): void {
  const currentTab = useUiStore((s) => s.currentTab)
  const [savedTab] = useState(readLastTab)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void window.api.getSetting("startupPage").then((value) => {
      if (cancelled) return
      const pref = typeof value === "string" ? value : STARTUP_PAGE_LAST
      const target = pref === STARTUP_PAGE_LAST ? savedTab : localPage(pref)
      if (useUiStore.getState().currentTab === "dashboard" && target) {
        useUiStore.getState().setCurrentTab(target)
      }
    }).catch(() => {}).finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [savedTab])
  useEffect(() => {
    if (!ready) return
    try { localStorage.setItem(LAST_TAB_KEY, currentTab) } catch { /* Optional preference. */ }
  }, [currentTab, ready])
}
