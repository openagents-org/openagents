import React from "react"
import { useTranslation } from "react-i18next"
import { RefreshCw } from "lucide-react"
import { useLauncherUpdate } from "../hooks/useLauncherUpdate"

/**
 * App-wide "an update is ready" banner. The old behavior only surfaced update
 * state inside Settings → Updates, so a background auto-download was invisible
 * and users thought automatic updates did nothing. This shows a one-click
 * "restart & install" the moment a download lands, on every screen. Dismiss is
 * session-only — the tray also carries a "Restart to update" item, and the
 * update still installs on the next quit regardless.
 */
export function LauncherUpdateBanner(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { state, install } = useLauncherUpdate()
  const [dismissed, setDismissed] = React.useState(false)

  if (dismissed) return null
  if (!state || state.status !== "downloaded") return null

  const version = state.latestVersion ?? ""

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-(--border) bg-(--bg-card) px-4 py-2 shadow-lg">
      <RefreshCw className="h-4 w-4 text-(--accent)" />
      <span className="text-[13px] text-(--text-primary)">
        {t("settings.updates.bannerReady", { version })}
      </span>
      <button
        type="button"
        className="rounded-md bg-(--accent) px-3 py-1 text-[12px] font-medium text-white hover:opacity-90"
        onClick={() => void install()}
      >
        {t("settings.updates.actionRestartInstall")}
      </button>
      <button
        type="button"
        className="text-[12px] text-(--text-secondary) hover:text-(--text-primary)"
        onClick={() => setDismissed(true)}
      >
        {t("settings.updates.bannerDismiss")}
      </button>
    </div>
  )
}
