import React from "react"
import {
  Activity,
  AlertCircle,
  ClipboardList,
  Users,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Card } from "../ui/card"
import { cn } from "../../lib/utils"
import type { Agent } from "../../types"

interface Props {
  agents: Agent[]
  workspaceCount: number
  todayMessageCount: number
  pendingUpdateCount: number
  className?: string
  /** Opens the update/agent surface behind the "needs attention" tile. */
  onClickAttention?: () => void
}

interface Tile {
  key: string
  label: string
  value: number
  icon: LucideIcon
  /** Background + foreground of the icon square, moved together. */
  tone: string
  detail?: string
  onClick?: () => void
}

const RUNNING_STATES = ["online", "running", "idle"]

function hasProblem(a: Agent): boolean {
  return a.state === "error" || !!a.lastError
}

export function StatsOverview({
  agents,
  workspaceCount,
  todayMessageCount,
  pendingUpdateCount,
  className,
  onClickAttention,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  const running = agents.filter((a) => RUNNING_STATES.includes(a.state)).length
  const problems = agents.filter(hasProblem).length
  const attention = pendingUpdateCount + problems

  // Spell out what is asking for attention — the count alone says nothing
  // about whether it is an update or an agent that fell over.
  const attentionDetail = [
    pendingUpdateCount
      ? t("dashboard.stats.attentionUpdates", { count: pendingUpdateCount })
      : null,
    problems ? t("dashboard.stats.attentionIssues", { count: problems }) : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const tiles: Tile[] = [
    {
      key: "running",
      label: t("dashboard.stats.runningAgents"),
      value: running,
      icon: Activity,
      tone: "bg-(--success-bg) text-(--success-text)",
    },
    {
      key: "messages",
      label: t("dashboard.stats.messagesToday"),
      value: todayMessageCount,
      icon: ClipboardList,
      tone: "bg-(--info-bg) text-(--info-text)",
    },
    {
      key: "workspaces",
      label: t("dashboard.stats.activeWorkspaces"),
      value: workspaceCount,
      icon: Users,
      tone: "bg-primary/10 text-primary",
    },
    {
      key: "attention",
      label: t("dashboard.stats.needsAttention"),
      value: attention,
      icon: AlertCircle,
      tone: attention
        ? "bg-(--danger-bg) text-(--danger-text)"
        : "bg-muted text-muted-foreground",
      detail: attention ? attentionDetail : t("dashboard.stats.allClear"),
      onClick: attention ? onClickAttention : undefined,
    },
  ]

  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {tiles.map((tile) => (
        <Card
          key={tile.key}
          role={tile.onClick ? "button" : undefined}
          tabIndex={tile.onClick ? 0 : undefined}
          onClick={tile.onClick}
          onKeyDown={(e) => {
            if (tile.onClick && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault()
              tile.onClick()
            }
          }}
          className={cn(
            "gap-0 px-4 py-3.5",
            tile.onClick && "cursor-pointer transition-shadow hover:shadow-md",
          )}
        >
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                tile.tone,
              )}
            >
              <tile.icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-2xs font-medium text-muted-foreground">
                {tile.label}
              </div>
              <div className="mt-1 text-2xl leading-none font-bold">
                {tile.value}
              </div>
              {tile.detail && (
                <div className="mt-1.5 truncate text-2xs text-muted-foreground">
                  {tile.detail}
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
