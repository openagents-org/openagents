import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { ToastType } from "@renderer/hooks/useToast"
import { formatBytes } from "@renderer/lib/format"
import { resetLocalPreferences } from "@renderer/lib/local-data"

interface SettingsIO {
  exportSettings: () => Promise<void>
  importSettings: () => Promise<void>
  resetOpen: boolean
  openReset: () => void
  closeReset: () => void
  resetting: boolean
  performReset: () => Promise<void>
  clearingCache: boolean
  clearCache: () => Promise<void>
  localResetOpen: boolean
  openLocalReset: () => void
  closeLocalReset: () => void
  performLocalReset: () => void
}

/**
 * Everything under Settings → Data: export / import / reset of the settings
 * file, plus the two controls for the launcher's own local state (Chromium's
 * cache and the renderer's localStorage).
 */
export function useSettingsIO(
  reload: () => Promise<void>,
  showToast: (msg: string, type?: ToastType) => void,
): SettingsIO {
  const { t } = useTranslation()
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [localResetOpen, setLocalResetOpen] = useState(false)

  const exportSettings = async (): Promise<void> => {
    try {
      // Goes through a native Save dialog in the main process. Cancelling is a
      // normal outcome, not a failure — and definitely not a success.
      const res = await window.api.exportSettingsToFile()
      if (res.canceled) return
      if (res.ok) showToast(t("settings.toasts.exported"), "success")
      else
        showToast(
          t("settings.toasts.exportFailed", { error: res.error || "" }),
          "error",
        )
    } catch (e) {
      showToast(
        t("settings.toasts.exportFailed", { error: (e as Error).message }),
        "error",
      )
    }
  }

  const importSettings = async (): Promise<void> => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json"
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0]
      if (!file) return
      const res = await window.api.importSettings(await file.text())
      if (res.ok) {
        await reload()
        showToast(t("settings.toasts.imported"), "success")
      } else {
        showToast(
          t("settings.toasts.importFailed", {
            error: res.error || t("settings.toasts.unknown"),
          }),
          "error",
        )
      }
    }
    input.click()
  }

  const performReset = async (): Promise<void> => {
    setResetting(true)
    try {
      await window.api.resetSettings()
      await reload()
      showToast(t("settings.toasts.reset"), "success")
    } finally {
      setResetting(false)
      setResetOpen(false)
    }
  }

  const clearCache = async (): Promise<void> => {
    setClearingCache(true)
    try {
      const res = await window.api.clearAppCache()
      if (res.ok) {
        // An already-empty cache reports nothing to free; "0 B freed" is noise.
        showToast(
          res.freed
            ? t("settings.toasts.cacheCleared", {
                size: formatBytes(res.freed),
              })
            : t("settings.toasts.cacheAlreadyEmpty"),
          "success",
        )
      } else {
        showToast(
          t("settings.toasts.cacheClearFailed", { error: res.error || "" }),
          "error",
        )
      }
    } finally {
      setClearingCache(false)
    }
  }

  // Synchronous: this is localStorage plus a repaint, and the window is already
  // wearing the result by the time the dialog closes.
  const performLocalReset = (): void => {
    resetLocalPreferences()
    setLocalResetOpen(false)
    showToast(t("settings.toasts.localDataReset"), "success")
  }

  return {
    exportSettings,
    importSettings,
    resetOpen,
    openReset: () => setResetOpen(true),
    closeReset: () => setResetOpen(false),
    resetting,
    performReset,
    clearingCache,
    clearCache,
    localResetOpen,
    openLocalReset: () => setLocalResetOpen(true),
    closeLocalReset: () => setLocalResetOpen(false),
    performLocalReset,
  }
}
