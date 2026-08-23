import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"

/**
 * Manual token connection is deprecated in favor of device pairing, but stays
 * functional for existing users. This notice rides on every manual-connect
 * surface and can be dismissed for good (per device).
 */
const MANUAL_DEPRECATION_KEY = "manual_connect_deprecation_dismissed"

export function manualNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(MANUAL_DEPRECATION_KEY) === "true"
  } catch {
    return false
  }
}

export function ManualDeprecationNotice(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(manualNoticeDismissed)

  if (dismissed) return null

  const dismiss = (): void => {
    try {
      localStorage.setItem(MANUAL_DEPRECATION_KEY, "true")
    } catch {}
    setDismissed(true)
  }

  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-(--warning-border,var(--border)) bg-(--warning-bg,transparent) px-3 py-2.5">
      <p className="m-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        {t("workspaces.manualDeprecation.notice")}
      </p>
      <button
        type="button"
        aria-label={t("workspaces.manualDeprecation.dismiss")}
        title={t("workspaces.manualDeprecation.dismiss")}
        onClick={dismiss}
        className="shrink-0 border-0 bg-transparent p-0 leading-none text-muted-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
