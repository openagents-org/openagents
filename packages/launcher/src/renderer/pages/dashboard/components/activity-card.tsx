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

import { Card } from "@renderer/components/ui/card"
import {
  canRouteNotification,
  routeNotification,
} from "@renderer/hooks/useNotificationRouting"
import { useNotificationsStore } from "@renderer/store/notifications"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import { cn } from "@renderer/lib/utils"
import type { NotifRecord } from "@renderer/types"

export interface ActivityEntry {
  time: string
  msg: string
}

interface Props {
  /** Renderer-side ephemeral log (toasts, etc). */
  uiActivity: ActivityEntry[]
  /** Persistent notifications from main. */
  notifications: NotifRecord[]
}

interface FeedItem {
  id: string
  time: string
  title: string
  body?: string
  icon: LucideIcon
  tint: string
  /** Set only when the entry actually leads somewhere. */
  onClick?: () => void
}

/** A dashboard panel, not a log — the bell holds the full history. */
const MAX_ROWS = 8

function notifIcon(kind: NotifRecord["kind"]): {
  icon: LucideIcon
  tint: string
} {
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

export function ActivityCard({
  uiActivity,
  notifications,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const markRead = useNotificationsStore((s) => s.markRead)

  // Notifications take precedence; both sources already arrive newest-first.
  const items: FeedItem[] = [
    ...notifications.slice(0, MAX_ROWS).map((n) => {
      const { icon, tint } = notifIcon(n.kind)
      return {
        id: `n:${n.id}`,
        time: relativeTimeAgo(t, n.createdAt),
        title: n.title,
        body: n.body,
        icon,
        tint,
        // Same destination the notification centre and the OS toast use, so
        // "gemini has a new version" lands on the marketplace from here too.
        onClick: canRouteNotification(n)
          ? () => {
              if (!n.read) void markRead(n.id)
              routeNotification(n)
            }
          : undefined,
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
    // Height follows the content: one notification should not reserve the
    // space ten would take.
    <Card className="gap-3 px-4 py-3.5">
      {/* No "view all": the bell in the rail is the full notification history,
          and the log page is raw daemon output rather than more of these. */}
      <h2 className="text-base font-semibold">{t("dashboard.activity.title")}</h2>

      {items.length === 0 ? (
        <p className="py-6 text-center text-2xs text-muted-foreground">
          {t("dashboard.activity.empty")}
        </p>
      ) : (
        <ul className="m-0 max-h-80 list-none space-y-1 overflow-y-auto p-0">
          {items.slice(0, MAX_ROWS).map((it) => (
            <li key={it.id}>
              <FeedRow item={it} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * One entry. Rendered as a button only when it leads somewhere — an ephemeral
 * line like "starting agent…" has no destination, and dressing it up as
 * clickable was the lie the dashboard was telling.
 */
function FeedRow({ item }: { item: FeedItem }): React.JSX.Element {
  const body = (
    <>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          item.tint,
        )}
      >
        <item.icon className="size-3" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs wrap-break-word">{item.title}</div>
        {item.body && (
          <div className="line-clamp-2 text-2xs wrap-break-word text-muted-foreground">
            {item.body}
          </div>
        )}
      </div>
      <span className="mt-0.5 shrink-0 text-3xs text-muted-foreground">
        {item.time}
      </span>
    </>
  )

  const layout =
    "flex w-full items-start gap-2.5 rounded-md px-1.5 py-1 text-left"

  if (!item.onClick) return <div className={layout}>{body}</div>

  return (
    <button
      type="button"
      onClick={item.onClick}
      className={cn(layout, "transition-colors hover:bg-muted/60")}
    >
      {body}
    </button>
  )
}
