import React from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Download, RefreshCw } from "lucide-react"
import { useLauncherUpdate } from "../hooks/useLauncherUpdate"
import { useUiStore } from "../store/ui"

/**
 * App-wide update banner. Update state used to be visible only inside
 * Settings → Updates, so a user sitting on the dashboard had no idea a new
 * version existed — the first signal was an OS toast well after the download
 * had already finished.
 *
 * It now surfaces the whole lifecycle: as soon as a new version is *found* the
 * banner appears with a one-click "update now" that starts the download and
 * drops the user on Settings → Updates to watch progress; while downloading it
 * shows live percent; once staged it becomes "restart & install".
 *
 * Dismiss is per state+version, so hiding the "available" prompt doesn't also
 * suppress the far more actionable "ready to install" one for that version.
 */
export function LauncherUpdateBanner(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { state, download, install } = useLauncherUpdate()
  const openSettingsSection = useUiStore((s) => s.openSettingsSection)
  const [dismissed, setDismissed] = React.useState<string | null>(null)

  const status = state?.status
  const version = state?.latestVersion ?? ""
  const isLive =
    status === "available" || status === "downloading" || status === "downloaded"
  // Identity of what's on screen right now. Changing status (or version)
  // re-shows the banner even if the previous stage was dismissed.
  const key = isLive ? `${status}:${version}` : null

  if (!state || !isLive || !key || dismissed === key) return null

  const goToUpdates = (): void => openSettingsSection("updates")

  // The in-app installer already failed twice for this version (a non-ASCII
  // Windows profile path is the usual cause). Retrying it would fail the same
  // way, so send the user to the download page instead.
  const installBroken =
    !!state.installFailedVersion && state.installFailedVersion === version

  let icon = <Download className="h-4 w-4 text-(--accent)" />
  let message = t("settings.updates.bannerAvailable", { version })
  let action: React.JSX.Element

  if (installBroken) {
    icon = <AlertTriangle className="h-4 w-4 text-(--danger-text)" />
    message = t("settings.updates.bannerInstallFailed", { version })
    action = (
      <button
        type="button"
        className="rounded-md bg-(--accent) px-3 py-1 text-xs font-medium text-white hover:opacity-90"
        onClick={() => window.api.openExternal(state.downloadUrl)}
      >
        {t("settings.updates.downloadPage")}
      </button>
    )
  } else if (status === "downloading") {
    icon = <Download className="h-4 w-4 animate-pulse text-(--accent)" />
    message = t("settings.updates.bannerDownloading", {
      version,
      percent: state.percent ?? 0,
    })
    action = (
      <button
        type="button"
        className="rounded-md border border-(--border) px-3 py-1 text-xs font-medium text-(--text-primary) hover:bg-(--bg-hover)"
        onClick={goToUpdates}
      >
        {t("settings.updates.bannerViewProgress")}
      </button>
    )
  } else if (status === "downloaded") {
    icon = <RefreshCw className="h-4 w-4 text-(--accent)" />
    message = t("settings.updates.bannerReady", { version })
    action = (
      <button
        type="button"
        className="rounded-md bg-(--accent) px-3 py-1 text-xs font-medium text-white hover:opacity-90"
        onClick={() => void install()}
      >
        {t("settings.updates.actionRestartInstall")}
      </button>
    )
  } else {
    action = (
      <button
        type="button"
        className="rounded-md bg-(--accent) px-3 py-1 text-xs font-medium text-white hover:opacity-90"
        onClick={() => {
          // Start the download AND navigate, so the progress the user was just
          // promised is on screen immediately rather than behind a second click.
          void download()
          goToUpdates()
        }}
      >
        {t("settings.updates.bannerUpdateNow")}
      </button>
    )
  }

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-lg border border-(--border) bg-(--bg-card) px-4 py-2 shadow-lg">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate text-sm text-(--text-primary)">
        {message}
      </span>
      <div className="shrink-0">{action}</div>
      <button
        type="button"
        className="shrink-0 text-xs text-(--text-secondary) hover:text-(--text-primary)"
        onClick={() => setDismissed(key)}
      >
        {t("settings.updates.bannerDismiss")}
      </button>
    </div>
  )
}
