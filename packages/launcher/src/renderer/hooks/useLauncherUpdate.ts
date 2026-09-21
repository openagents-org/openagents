import { useEffect, useState } from "react"
import type { UpdaterState } from "../types"

/**
 * Subscribe to launcher self-update state (electron-updater, surfaced by the
 * main process). Used by the global update banner and the Settings → Updates
 * panel so both reflect the same live status — checking → available →
 * downloading → downloaded — without each re-implementing the IPC plumbing.
 */
export function useLauncherUpdate(): {
  state: UpdaterState | null
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
} {
  const [state, setState] = useState<UpdaterState | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.getUpdaterState().then((s) => {
      if (alive) setState(s)
    })
    const off = window.api.onUpdaterEvent((s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  return {
    state,
    check: async () => {
      setState(await window.api.checkLauncherUpdate())
    },
    download: async () => {
      await window.api.downloadLauncherUpdate()
    },
    install: async () => {
      await window.api.installLauncherUpdate()
    },
  }
}
