import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { ToastType } from "@renderer/hooks/useToast"

interface SettingsIO {
  exportSettings: () => Promise<void>
  importSettings: () => Promise<void>
  resetOpen: boolean
  openReset: () => void
  closeReset: () => void
  resetting: boolean
  performReset: () => Promise<void>
}

/** Export / import / reset of the whole settings file. */
export function useSettingsIO(
  reload: () => Promise<void>,
  showToast: (msg: string, type?: ToastType) => void,
): SettingsIO {
  const { t } = useTranslation()
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

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

  return {
    exportSettings,
    importSettings,
    resetOpen,
    openReset: () => setResetOpen(true),
    closeReset: () => setResetOpen(false),
    resetting,
    performReset,
  }
}
