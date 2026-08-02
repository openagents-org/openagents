import React from "react"
import { useTranslation } from "react-i18next"

import { Card } from "@renderer/components/ui/card"
import { cn } from "@renderer/lib/utils"
import type { WorkspaceStats } from "../use-workspaces-data"

interface Props {
  stats: WorkspaceStats
}

/** Health counters, tinted by what they mean; the total stays neutral. */
const METRICS = [
  { key: "healthy", tone: "text-success" },
  { key: "warning", tone: "text-warning" },
  { key: "error", tone: "text-destructive" },
  { key: "total", tone: "text-foreground" },
] as const

export function WorkspacesStats({ stats }: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    // Four across, unconditionally: the window has a 1200px minimum, so the
    // narrow-viewport fallbacks the rest of the app carries never apply here.
    <div className="mb-4 grid grid-cols-4 gap-3">
      {METRICS.map(({ key, tone }) => (
        <Card key={key} className="gap-1 px-4 py-3.5">
          <span className={cn("text-xl font-bold tabular-nums", tone)}>
            {stats[key]}
          </span>
          <span className="text-2xs text-muted-foreground">
            {t(`workspaces.stats.${key}`)}
          </span>
        </Card>
      ))}
    </div>
  )
}
