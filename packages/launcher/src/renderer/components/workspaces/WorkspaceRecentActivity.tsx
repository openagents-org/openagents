import * as React from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"

export interface RecentActivityProps {
  /** ISO timestamp of the workspace's most recent message (any channel). */
  lastMessageAt: string | null
  /** Short preview of that message. */
  lastMessagePreview: string | null
  /** Number of stored sessions for this workspace. */
  sessionCount: number
}

function relativeTime(iso: string | null, t: TFunction): string {
  if (!iso) return t("workspaces.relativeTime.never")
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return t("workspaces.relativeTime.never")
  const diff = Date.now() - ts
  if (diff < 60_000) return t("workspaces.relativeTime.justNow")
  if (diff < 3_600_000)
    return t("workspaces.relativeTime.minutesAgo", {
      count: Math.floor(diff / 60_000),
    })
  if (diff < 86_400_000)
    return t("workspaces.relativeTime.hoursAgo", {
      count: Math.floor(diff / 3_600_000),
    })
  return t("workspaces.relativeTime.daysAgo", {
    count: Math.floor(diff / 86_400_000),
  })
}

export function WorkspaceRecentActivity({
  lastMessageAt,
  lastMessagePreview,
  sessionCount,
}: RecentActivityProps): React.JSX.Element {
  const { t } = useTranslation()
  if (!lastMessageAt) {
    return (
      <div className="text-2xs italic text-muted-foreground">
        {sessionCount > 0
          ? t("workspaces.recentActivity.noActivityWithSessions", {
              count: sessionCount,
            })
          : t("workspaces.recentActivity.noActivity")}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-3xs uppercase tracking-wider text-muted-foreground">
        {t("workspaces.recentActivity.lastMessage", {
          time: relativeTime(lastMessageAt, t),
        })}
      </div>
      <div className="truncate text-2xs text-muted-foreground">
        {lastMessagePreview || t("workspaces.recentActivity.noPreview")}
      </div>
    </div>
  )
}

export { relativeTime as workspaceRelativeTime }
