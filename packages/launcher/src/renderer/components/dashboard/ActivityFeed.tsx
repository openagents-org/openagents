import React from "react"
import {
  Activity,
  AlertOctagon,
  AtSign,
  Bell,
  Github,
  MessageSquare,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../ui/button"
import { Card } from "../ui/card"
import { cn } from "../../lib/utils"
import type { NotifRecord } from "../../types"
import { relativeTime } from "./relative-time"

export interface ActivityEntry {
  time: string
  msg: string
}

interface Props {
  /** Renderer-side ephemeral log (toasts, etc) */
  uiActivity: ActivityEntry[]
  /** Persistent notifications from main */
  notifications: NotifRecord[]
  onViewAll?: () => void
}

interface FeedItem {
  id: string
  time: string
  title: string
  body?: string
  icon: LucideIcon
  tint: string
}

/** Newest notifications to consider before the feed becomes noise. */
const MAX_NOTIFICATIONS = 50
/** Rows actually rendered. */
const MAX_ROWS = 30

function notifIcon(kind: NotifRecord["kind"]): { icon: LucideIcon; tint: string } {
  switch (kind) {
    case "agent_error":
    case "workspace_error":
    case "platform_error":
      return { icon: AlertOctagon, tint: "bg-(--danger-bg) text-(--danger-text)" }
    case "agent_mention":
    case "workspace_mention":
      return { icon: AtSign, tint: "bg-primary/10 text-primary" }
    case "workspace_message":
      return { icon: MessageSquare, tint: "bg-(--info-bg) text-(--info-text)" }
    case "github":
      return { icon: Github, tint: "bg-muted text-muted-foreground" }
    default:
      return { icon: Bell, tint: "bg-muted text-muted-foreground" }
  }
}

export function ActivityFeed({
  uiActivity,
  notifications,
  onViewAll,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  // Notifications take precedence; both sources already arrive newest-first.
  const items: FeedItem[] = [
    ...notifications.slice(0, MAX_NOTIFICATIONS).map((n) => {
      const { icon, tint } = notifIcon(n.kind)
      return {
        id: `n:${n.id}`,
        time: relativeTime(t, n.createdAt),
        title: n.title,
        body: n.body,
        icon,
        tint,
      }
    }),
    ...uiActivity.map((e, i) => ({
      id: `u:${i}:${e.time}`,
      time: e.time,
      title: e.msg,
      icon: Activity,
      tint: "bg-muted text-muted-foreground",
    })),
  ]

  return (
    <Card className="min-h-70 flex-1 gap-3 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("dashboard.activity.title")}</h3>
        {onViewAll && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-2xs"
            onClick={onViewAll}
          >
            {t("dashboard.activity.viewAll")}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-6 text-center text-2xs text-muted-foreground">
          {t("dashboard.activity.empty")}
        </p>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none space-y-1 overflow-y-auto p-0">
          {items.slice(0, MAX_ROWS).map((it) => (
            <li key={it.id} className="flex items-start gap-2.5 rounded-sm py-1">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  it.tint,
                )}
              >
                <it.icon className="size-3" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs wrap-break-word">{it.title}</div>
                {it.body && (
                  <div className="line-clamp-2 text-2xs wrap-break-word text-muted-foreground">
                    {it.body}
                  </div>
                )}
              </div>
              <span className="mt-0.5 shrink-0 text-3xs text-muted-foreground">
                {it.time}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
