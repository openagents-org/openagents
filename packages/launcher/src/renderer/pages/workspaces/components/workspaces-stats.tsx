import React from "react"
import { useTranslation } from "react-i18next"
import { Layers } from "lucide-react"

import { Card } from "@renderer/components/ui/card"
import { cn } from "@renderer/lib/utils"
import type { WorkspaceStats } from "../use-workspaces-data"

interface Props {
  stats: WorkspaceStats
}

/**
 * Health counters. Each carries the same coloured dot the cards below use, so
 * the eye can go straight from a tile to the cards it counts; the total stays
 * neutral.
 *
 * There is deliberately no "vs last week" delta: nothing in the launcher keeps
 * a history to compare against, and an invented trend on a health counter is
 * worse than no trend at all.
 */
const METRICS = [
  { key: "healthy", dot: "bg-success", value: "text-success" },
  { key: "warning", dot: "bg-warning", value: "text-warning" },
  { key: "error", dot: "bg-destructive", value: "text-destructive" },
  { key: "total", dot: "", value: "text-foreground" },
] as const

export function WorkspacesStats({ stats }: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    // Four across, unconditionally: the window has a 1200px minimum, so the
    // narrow-viewport fallbacks the rest of the app carries never apply here.
    <div className="mb-4 grid grid-cols-4 gap-3">
      {METRICS.map(({ key, dot, value }) => (
        <Card key={key} className="gap-2 px-4 py-3.5">
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            {dot ? (
              <span className={cn("size-1.5 rounded-full", dot)} />
            ) : (
              <Layers className="size-3" />
            )}
            {t(`workspaces.stats.${key}`)}
          </div>
          <span className={cn("text-xl font-bold tabular-nums", value)}>
            {stats[key]}
          </span>
        </Card>
      ))}
    </div>
  )
}
