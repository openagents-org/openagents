import React from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Download, RefreshCw } from "lucide-react"
import { useLauncherUpdate } from "../hooks/useLauncherUpdate"
import { useUiStore } from "../store/ui"
import { useAccountStore } from "../store/account"

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
 * It also lives in the UI store rather than in local state, so clicking the
 * "update ready" notification can bring a dismissed banner back.
 */
export function LauncherUpdateBanner({
  inline = false,
}: {
  /**
   * Drawn inside the mode bar. The Workspace's native view covers everything
   * below the bar, so a floating banner would be hidden behind it.
   */
  inline?: boolean
} = {}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { state, download, install } = useLauncherUpdate()
  const openSettingsSection = useUiStore((s) => s.openSettingsSection)
  const dismissed = useUiStore((s) => s.updateBannerDismissed)
  const setDismissed = useUiStore((s) => s.dismissUpdateBanner)

  // Settings → Updates says all of this in full, with a real progress bar and
  // the buttons to go with it. Repeating it in a floating strip over the same
  // page is noise — and the banner's own "view progress" leads here, so it
  // would otherwise survive the click that was supposed to answer it. Leaving
  // the page brings it back, download still running or not: it is not
  // dismissed, just deferring to the page that outranks it.
  const onUpdatesPage = useUiStore(
    (s) => s.visibleSettingsSection === "updates",
  )
  // Same reasoning for the prompt: it is this offer in full, with the release
  // notes and the buttons that act on it. A one-line copy of it behind the
  // dialog answers, from the back, the question being asked at the front.
  const promptOpen = useUiStore((s) => s.updatePromptOpen)

  const status = state?.status
  const version = state?.latestVersion ?? ""
  const isLive =
    status === "available" ||
    status === "downloading" ||
    status === "downloaded"
  // Identity of what's on screen right now. Changing status (or version)
  // re-shows the banner even if the previous stage was dismissed.
  const key = isLive ? `${status}:${version}` : null

  // This banner is the automatic path's UI: it reports a download that is
  // already happening, on the strength of a preference the user has given. With
  // automatic downloads off, nothing is happening and nothing has been agreed —
  // the prompt asks, and a banner alongside it would just be a second, weaker
  // copy of the same offer.
  if (state && !state.autoDownload) return null
  if (onUpdatesPage || promptOpen) return null
  if (!state || !isLive || !key || dismissed === key) return null

  const goToUpdates = (): void => {
    // Settings lives on the This Computer side of the window.
    if (inline) useAccountStore.getState().exitWorkspace()
    openSettingsSection("updates")
  }

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
      <WhatsNewButton
        onClick={goToUpdates}
        label={t("settings.updates.bannerWhatsNew")}
      />
    )
  } else if (status === "downloaded") {
    icon = <RefreshCw className="h-4 w-4 text-(--accent)" />
    message = t("settings.updates.bannerReady", { version })
    action = (
      <>
        {/* Restarting into a new version is easier to agree to after reading
            what it changes, and Settings → Updates is where those notes are. */}
        {!inline && (
          <WhatsNewButton
            onClick={goToUpdates}
            label={t("settings.updates.bannerWhatsNew")}
          />
        )}
        <button
          type="button"
          className="rounded-md bg-(--accent) px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          onClick={() => void install()}
        >
          {t("settings.updates.actionRestartInstall")}
        </button>
      </>
    )
  } else {
    action = (
      <>
        {/* "A new version exists" is not a reason to update; what it changes
            is. Available is exactly when someone wants to read that. */}
        {!inline && (
          <WhatsNewButton
            onClick={goToUpdates}
            label={t("settings.updates.bannerWhatsNew")}
          />
        )}
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
      </>
    )
  }

  return (
    // `top` clears whatever the content area reserved for the window buttons
    // and `mt-3` is the gap below it — the banner is centred over that pane, so
    // it is that pane's inset it has to respect. Anchored at the window's true
    // top edge it would sit in the band the buttons are drawn in.
    <div
      className={
        inline
          ? "flex h-7 min-w-0 items-center gap-2 rounded-md border border-(--border) bg-(--bg-card) px-2 [&_button]:py-0.5"
          : "absolute top-(--mode-bar-h) left-1/2 z-50 mt-3 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-(--border) bg-(--bg-card) px-4 py-2 shadow-lg"
      }
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate text-sm text-(--text-primary)">
        {message}
      </span>
      <div className="flex shrink-0 items-center gap-2">{action}</div>
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

/** The banner's secondary action: go read what the version changes. */
function WhatsNewButton({
  onClick,
  label,
}: {
  onClick: () => void
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="rounded-md border border-(--border) px-3 py-1 text-xs font-medium text-(--text-primary) hover:bg-(--bg-hover)"
      onClick={onClick}
    >
      {label}
    </button>
  )
}
