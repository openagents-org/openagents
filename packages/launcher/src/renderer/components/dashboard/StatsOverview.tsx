import React from "react"
import {
  Cpu,
  Download,
  Layers,
  MessageSquare,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../shadcn/button"
import { Card } from "../shadcn/card"
import { cn } from "../../lib/utils"
import type { Agent, AgentUpdateInfo, ConnectionRecord } from "../../types"

interface Props {
  agents: Agent[]
  workspaceCount: number
  connections: ConnectionRecord[]
  todayMessageCount: number
  yesterdayMessageCount?: number
  installedCount?: number
  pendingUpdateCount?: number
  pendingUpdates?: AgentUpdateInfo[]
  className?: string
  onClickUpdates?: () => void
}

interface Trend {
  up: boolean
  text: string
}

interface CardSpec {
  label: string
  value: number | string
  icon: LucideIcon
  iconClass: string
  trend?: Trend
  link?: { text: string; onClick: () => void }
}

const RUNNING_STATES = ["online", "running", "idle"]

export function StatsOverview({
  agents,
  workspaceCount,
  todayMessageCount,
  yesterdayMessageCount,
  installedCount,
  pendingUpdateCount,
  className,
  onClickUpdates,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const running = agents.filter((a) => RUNNING_STATES.includes(a.state)).length

  // Only meaningful once there is a prior day to compare against.
  const messagesTrend = ((): Trend | undefined => {
    if (!yesterdayMessageCount) return undefined
    const pct = Math.round(
      ((todayMessageCount - yesterdayMessageCount) / yesterdayMessageCount) * 100,
    )
    if (pct === 0) return undefined
    return {
      up: pct > 0,
      text: t("dashboard.stats.trendVsAvg", {
        symbol: pct > 0 ? "▲" : "▼",
        pct: Math.abs(pct),
      }),
    }
  })()

  const cards: CardSpec[] = [
    {
      label: t("dashboard.stats.runningAgents"),
      value: running,
      icon: Cpu,
      iconClass: "text-(--success-text)",
    },
    {
      label: t("dashboard.stats.messagesToday"),
      value: todayMessageCount,
      icon: MessageSquare,
      iconClass: "text-primary",
      trend: messagesTrend,
    },
    {
      label: t("dashboard.stats.activeWorkspaces"),
      value: workspaceCount,
      icon: Layers,
      iconClass: "text-primary",
    },
    {
      label: t("dashboard.stats.installedAgents"),
      value: installedCount ?? agents.length,
      icon: Download,
      iconClass: "text-primary",
      link: pendingUpdateCount
        ? {
            text: t("dashboard.stats.updatesAvailable", { count: pendingUpdateCount }),
            onClick: onClickUpdates ?? ((): void => {}),
          }
        : undefined,
    },
  ]

  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {cards.map((c) => (
        <Card key={c.label} className="gap-0 px-4 py-3.5">
          <div className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            <c.icon className={cn("size-3.5", c.iconClass)} />
            <span className="leading-tight">{c.label}</span>
          </div>
          <div className="mt-2 text-2xl leading-tight font-bold">{c.value}</div>
          {c.trend && (
            <div
              className={cn(
                "mt-1.5 flex items-center gap-1 text-2xs font-medium",
                c.trend.up ? "text-(--success-text)" : "text-(--danger-text)",
              )}
            >
              {c.trend.up ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              <span>{c.trend.text}</span>
            </div>
          )}
          {c.link && (
            <Button
              variant="link"
              size="sm"
              className="mt-1.5 h-auto justify-start p-0 text-2xs"
              onClick={c.link.onClick}
            >
              {c.link.text}
            </Button>
          )}
        </Card>
      ))}
    </div>
  )
}
