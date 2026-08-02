import React from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/shadcn/button"
import { SettingsCard, Row } from "./settings-card"
import { cn } from "@renderer/lib/utils"
import type { UpdaterState } from "@renderer/types"

export function LauncherUpdate({
  state,
  currentVersion,
  onCheck,
  onDownload,
  onInstall,
}: {
  state: UpdaterState | null
  currentVersion: string
  onCheck: () => void | Promise<void>
  onDownload: () => void | Promise<void>
  onInstall: () => void | Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const status = state?.status ?? "idle"
  const latest = state?.latestVersion ? `v${state.latestVersion}` : null

  // There is deliberately no `!state.supported` special case. Unpackaged builds
  // now check the real release feed too (see updater.ts / dev-app-update.yml),
  // so every build renders the same states — and the idle state below is already
  // exactly "Current version X · [Check for updates]".

  // We handed this version to the installer at least twice and came back up on
  // the old build both times — on Windows that is almost always a profile path
  // the NSIS handoff can't represent. Offering "Restart & install" again would
  // just repeat the no-op, so switch to a manual download. Main clears the flag
  // as soon as a *different* version shows up, so this can't get stuck.
  if (state?.installFailedVersion) {
    return (
      <Row
        label={t("settings.updates.appUpdate")}
        desc={t("settings.updates.installFailedDesc", {
          version: state.installFailedVersion,
          current: currentVersion,
        })}
      >
        <Button
          variant="default"
          size="sm"
          onClick={() =>
            window.api.openExternal(
              state.downloadUrl ||
                "https://github.com/openagents-org/openagents/releases",
            )
          }
        >
          {t("settings.updates.downloadPage")}
        </Button>
      </Row>
    )
  }

  let statusText = t("settings.updates.currentVersion", { version: currentVersion })
  if (status === "checking") statusText = t("settings.updates.checking")
  else if (status === "available")
    statusText = t("settings.updates.available", { version: latest ?? "" })
  else if (status === "downloading")
    statusText = t("settings.updates.downloading", { version: latest ?? "", percent: state?.percent ?? 0 })
  else if (status === "downloaded")
    statusText = t("settings.updates.downloaded", { version: latest ?? t("settings.updates.updateFallback") })
  else if (status === "not-available")
    statusText = t("settings.updates.upToDate", { version: currentVersion })
  else if (status === "error")
    statusText = t("settings.updates.error", { error: state?.error ?? t("settings.toasts.unknown") })

  const busy = status === "checking" || status === "downloading"

  let action: React.JSX.Element
  if (status === "available") {
    action = (
      <Button variant="default" size="sm" onClick={() => void onDownload()}>
        {t("common.download")}
      </Button>
    )
  } else if (status === "downloading") {
    action = (
      <Button variant="outline" size="sm" disabled>
        {t("settings.updates.actionDownloading")}
      </Button>
    )
  } else if (status === "downloaded") {
    action = (
      <Button variant="default" size="sm" onClick={() => void onInstall()}>
        {t("settings.updates.actionRestartInstall")}
      </Button>
    )
  } else {
    action = (
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void onCheck()}
      >
        {status === "checking" ? t("settings.updates.actionChecking") : t("settings.updates.actionCheck")}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-2 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <span
          className={cn(
            "text-sm font-medium min-w-0 truncate",
            status === "error"
              ? "text-(--danger-text)"
              : status === "available" || status === "downloaded"
                ? "text-(--accent)"
                : "text-(--text-primary)",
          )}
        >
          {statusText}
        </span>
        <div className="shrink-0">{action}</div>
      </div>
      {status === "downloading" && (
        <div className="h-1.5 w-full rounded-full bg-(--bg-input) overflow-hidden">
          <div
            className="h-full bg-(--accent) transition-[width] duration-200"
            style={{ width: `${state?.percent ?? 0}%` }}
          />
        </div>
      )}
    </div>
  )
}
