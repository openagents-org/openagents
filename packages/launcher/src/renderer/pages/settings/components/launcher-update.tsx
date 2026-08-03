import React from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
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
        footer={
          <>
            {downloading && <Progress value={percent} className="h-1.5" />}
            <ReleaseNotesLink />
          </>
        }
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
      tone="neutral"
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
      footer={<ReleaseNotesLink />}
    />
  )
}

function ReleaseNotesLink(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="cursor-pointer self-start border-0 bg-transparent p-0 text-2xs text-(--accent) hover:underline"
      onClick={() => window.api.openExternal(RELEASES_URL)}
    >
      {t("settings.updates.releaseNotes")}
    </button>
  )
}

const TONE: Record<string, string> = {
  accent: "border-(--accent-border) bg-(--accent-bg)",
  warning: "border-(--warning-border) bg-(--warning-bg)",
  danger: "border-(--danger-border) bg-(--danger-bg)",
  neutral: "",
}

const ICON_TONE: Record<string, string> = {
  accent: "text-(--accent)",
  warning: "text-(--warning-text)",
  danger: "text-(--danger-text)",
  neutral: "text-muted-foreground",
}

function Panel({
  tone,
  icon,
  title,
  subtitle,
  action,
  footer,
}: {
  tone: keyof typeof TONE
  icon: React.ReactNode
  title: string
  subtitle?: string
  action: React.ReactNode
  footer?: React.ReactNode
}): React.JSX.Element {
  return (
    <Card className={cn("mb-4 gap-3 px-5 py-4", TONE[tone])}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 shrink-0", ICON_TONE[tone])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          {subtitle && (
            <div className="mt-0.5 text-2xs text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      {footer && <div className="flex flex-col gap-2">{footer}</div>}
    </Card>
  )
}
