import React from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { Progress } from "@renderer/components/ui/progress"
import { cn } from "@renderer/lib/utils"
import type { UpdaterState } from "@renderer/types"

const RELEASES_URL = "https://github.com/openagents-org/openagents/releases"

interface Props {
  state: UpdaterState | null
  currentVersion: string
  onCheck: () => void | Promise<void>
  onDownload: () => void | Promise<void>
  onInstall: () => void | Promise<void>
}

/**
 * The headline of the Updates section: what version you are on, what is
 * available, and the single action that moves you forward.
 *
 * There is deliberately no `!state.supported` special case. Unpackaged builds
 * check the real release feed too (see updater.ts / dev-app-update.yml), so
 * every build renders the same states.
 */
export function LauncherUpdate({
  state,
  currentVersion,
  onCheck,
  onDownload,
  onInstall,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const status = state?.status ?? "idle"
  const latest = state?.latestVersion ? `v${state.latestVersion}` : null
  const percent = Math.round(state?.percent ?? 0)

  // We handed this version to the installer at least twice and came back up on
  // the old build both times — on Windows that is almost always a profile path
  // the NSIS handoff can't represent. Offering "Restart & install" again would
  // just repeat the no-op, so switch to a manual download. Main clears the flag
  // as soon as a *different* version shows up, so this can't get stuck.
  if (state?.installFailedVersion) {
    return (
      <Panel
        tone="warning"
        icon={<AlertTriangle className="size-5" />}
        title={t("settings.updates.available", {
          version: `v${state.installFailedVersion}`,
        })}
        subtitle={t("settings.updates.installFailedDesc", {
          version: state.installFailedVersion,
          current: currentVersion,
        })}
        action={
          <Button
            size="sm"
            onClick={() =>
              window.api.openExternal(state.downloadUrl || RELEASES_URL)
            }
          >
            {t("settings.updates.downloadPage")}
          </Button>
        }
      />
    )
  }

  if (status === "available" || status === "downloading" || status === "downloaded") {
    const downloading = status === "downloading"
    return (
      <Panel
        tone="accent"
        icon={<Sparkles className="size-5" />}
        title={t("settings.updates.available", { version: latest ?? "" })}
        subtitle={
          downloading
            ? t("settings.updates.downloading", {
                version: latest ?? "",
                percent,
              })
            : status === "downloaded"
              ? t("settings.updates.downloaded", { version: latest ?? "" })
              : t("settings.updates.currentVersion", { version: currentVersion })
        }
        action={
          downloading ? (
            <Button size="sm" disabled>
              <Loader2 className="animate-spin" />
              {t("settings.updates.actionDownloading")}
            </Button>
          ) : status === "downloaded" ? (
            <Button size="sm" onClick={() => void onInstall()}>
              {t("settings.updates.actionRestartInstall")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void onDownload()}>
              <Download />
              {t("common.download")}
            </Button>
          )
        }
        link={<ReleaseNotesLink />}
        footer={downloading && <Progress value={percent} className="h-1.5" />}
      />
    )
  }

  if (status === "error") {
    return (
      <Panel
        tone="danger"
        icon={<AlertTriangle className="size-5" />}
        title={t("settings.updates.error", {
          error: state?.error ?? t("settings.toasts.unknown"),
        })}
        subtitle={t("settings.updates.currentVersion", { version: currentVersion })}
        action={
          <Button size="sm" variant="outline" onClick={() => void onCheck()}>
            <RefreshCw />
            {t("settings.updates.actionCheck")}
          </Button>
        }
      />
    )
  }

  const checking = status === "checking"
  return (
    <Panel
      // Green only once a check has actually come back clean; before that the
      // panel states the version without claiming it is the newest one.
      tone={status === "not-available" ? "success" : "neutral"}
      icon={
        checking ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <CheckCircle2 className="size-5" />
        )
      }
      title={
        checking
          ? t("settings.updates.checking")
          : status === "not-available"
            ? t("settings.updates.upToDate", { version: currentVersion })
            : t("settings.updates.currentVersion", { version: currentVersion })
      }
      subtitle={t("settings.updates.checkHint")}
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={checking}
          onClick={() => void onCheck()}
        >
          <RefreshCw className={cn(checking && "animate-spin")} />
          {checking
            ? t("settings.updates.actionChecking")
            : t("settings.updates.actionCheck")}
        </Button>
      }
      link={<ReleaseNotesLink />}
    />
  )
}

function ReleaseNotesLink(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="flex items-center gap-1 border-0 bg-transparent p-0 text-2xs text-(--accent) hover:underline"
      onClick={() => window.api.openExternal(RELEASES_URL)}
    >
      {t("settings.updates.releaseNotes")}
      <ExternalLink className="size-3" />
    </button>
  )
}

const TONE: Record<string, string> = {
  accent: "border-(--accent-border) bg-(--accent-bg)",
  warning: "border-(--warning-border) bg-(--warning-bg)",
  danger: "border-(--danger-border) bg-(--danger-bg)",
  success: "",
  neutral: "",
}

const ICON_TONE: Record<string, string> = {
  accent: "bg-(--accent-bg) text-(--accent)",
  warning: "bg-(--warning-bg) text-(--warning-text)",
  danger: "bg-(--danger-bg) text-(--danger-text)",
  success: "bg-(--success-bg) text-(--success-text)",
  neutral: "bg-muted text-muted-foreground",
}

/**
 * The status headline. The action column stacks — the button first, the
 * release-notes link under it — so the link belongs to the action rather than
 * floating under the copy, whatever state the panel is in.
 */
function Panel({
  tone,
  icon,
  title,
  subtitle,
  action,
  link,
  footer,
}: {
  tone: keyof typeof TONE
  icon: React.ReactNode
  title: string
  subtitle?: string
  action: React.ReactNode
  /** Sits under the action, right-aligned — the release-notes link. */
  link?: React.ReactNode
  /** Full width under the row, for the download progress bar. */
  footer?: React.ReactNode
}): React.JSX.Element {
  return (
    <Card className={cn("mb-5 gap-4 px-6 py-5", TONE[tone])}>
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            ICON_TONE[tone],
          )}
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1 pt-1">
          <div className="text-sm font-semibold">{title}</div>
          {subtitle && (
            <div className="mt-1 text-2xs text-muted-foreground">{subtitle}</div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {action}
          {link}
        </div>
      </div>
      {footer}
    </Card>
  )
}
