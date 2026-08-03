import React from "react"
import { Bot, CircleAlert, FileText, TriangleAlert, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Card } from "@renderer/components/ui/card"
import { cn } from "@renderer/lib/utils"
import { seriesOf, type TimeBucket } from "@renderer/services/logs/log-metrics"
import { Sparkline } from "./sparkline"

interface Props {
  buckets: TimeBucket[]
  total: number
  errors: number
  warnings: number
  activeAgents: number
  /** Clicking a tile narrows the level filter to what it counts. */
  onFocusLevel: (level: "all" | "error" | "warn") => void
}

interface Tile {
  key: string
  label: string
  value: number
  icon: LucideIcon
  /** Icon square tint. */
  tone: string
  /** Line colour; also tints the area fill. */
  trend: string
  series: number[]
  onClick?: () => void
}

export function LogsStats({
  buckets,
  total,
  errors,
  warnings,
  activeAgents,
  onFocusLevel,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  const tiles: Tile[] = [
    {
      key: "total",
      label: t("logs.stats.total"),
      value: total,
      icon: FileText,
      tone: "bg-(--info-bg) text-(--info-text)",
      trend: "text-primary",
      series: seriesOf(buckets, (b) => b.total),
      onClick: () => onFocusLevel("all"),
    },
    {
      key: "errors",
      label: t("logs.stats.errors"),
      value: errors,
      icon: CircleAlert,
      tone: "bg-(--danger-bg) text-(--danger-text)",
      trend: "text-(--danger)",
      series: seriesOf(buckets, (b) => b.error),
      onClick: () => onFocusLevel("error"),
    },
    {
      key: "warnings",
      label: t("logs.stats.warnings"),
      value: warnings,
      icon: TriangleAlert,
      tone: "bg-(--warning-bg) text-(--warning-text)",
      trend: "text-(--warning)",
      series: seriesOf(buckets, (b) => b.warn),
      onClick: () => onFocusLevel("warn"),
    },
    {
      key: "agents",
      label: t("logs.stats.activeAgents"),
      value: activeAgents,
      icon: Bot,
      tone: "bg-primary/10 text-primary",
      trend: "text-primary",
      series: seriesOf(buckets, (b) => b.agents.length),
    },
  ]

  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
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
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full",
                tile.tone,
              )}
            >
              <tile.icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-2xs font-medium text-muted-foreground">
                {tile.label}
              </div>
              <div className="mt-1 text-2xl leading-none font-bold tabular-nums">
                {tile.value.toLocaleString()}
              </div>
            </div>
            <div className="ml-auto w-24 shrink-0">
              <Sparkline values={tile.series} className={tile.trend} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
