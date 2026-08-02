import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import type { UpdaterState } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

interface LauncherUpdater {
  updater: UpdaterState | null
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
}

/**
 * Launcher self-update state and actions.
 *
 * `sectionIsUpdates` drives an auto-check the moment the user opens the Updates
 * section, so it resolves to "Up to date (vX)" / "New version available"
 * instead of sitting on a stale "Current version · Check for updates". Manual
 * checks stay user-driven — this never auto-downloads.
 */
export function useLauncherUpdater(
  sectionIsUpdates: boolean,
  showToast: (msg: string, type?: ToastType) => void,
): LauncherUpdater {
  const { t } = useTranslation()
  const [updater, setUpdater] = useState<UpdaterState | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    window.api
      .getUpdaterState()
      .then((s) => {
        if (mounted.current) setUpdater(s)
      })
      .catch(() => {})
    return window.api.onUpdaterEvent((s) => {
      if (mounted.current) setUpdater(s)
    })
  }, [])

  useEffect(() => {
    if (!sectionIsUpdates || !updater?.supported) return
    const s = updater.status
    if (s === "checking" || s === "downloading" || s === "downloaded") return
    window.api.checkLauncherUpdate().then(
      (next) => {
        if (mounted.current) setUpdater(next)
      },
      () => {},
    )
    // Only re-run when the section changes, not on every updater tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIsUpdates])

  const report = (key: string, e: unknown): void =>
    showToast(t(key, { error: (e as Error).message }), "error")

  return {
    updater,
    check: async () => {
      try {
        const s = await window.api.checkLauncherUpdate()
        setUpdater(s)
        if (s.status === "not-available")
          showToast(t("settings.toasts.alreadyUpToDate"), "success")
      } catch (e) {
        report("settings.toasts.updateCheckFailed", e)
      }
    },
    download: async () => {
      try {
        await window.api.downloadLauncherUpdate()
      } catch (e) {
        report("settings.toasts.downloadFailed", e)
      }
    },
    install: async () => {
      try {
        await window.api.installLauncherUpdate()
      } catch (e) {
        report("settings.toasts.installFailed", e)
      }
    },
  }
}
