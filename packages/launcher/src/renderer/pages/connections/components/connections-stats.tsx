import React from "react"
import { Clock } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Card } from "@renderer/components/ui/card"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import { cn } from "@renderer/lib/utils"

import type { ConnectionStats } from "../use-connections-view"

/**
 * Counters for the three states a platform can be in, plus how fresh the
 * newest credential check is. Deliberately plain numbers — the launcher keeps
 * no history, so there is no trend to draw here honestly.
 */
const COUNTERS = [
  { key: "connected", dot: "bg-success", value: "text-success" },
  { key: "pending", dot: "bg-muted-foreground", value: "text-foreground" },
  { key: "planned", dot: "bg-warning", value: "text-warning" },
] as const

export function ConnectionsStats({
  stats,
}: {
  stats: ConnectionStats
}): React.JSX.Element {
  const { t } = useTranslation()
  const synced =
    relativeTimeAgo(t, stats.lastSyncAt) || t("connections.stats.never")

  return (
    <div className="mb-4 grid grid-cols-4 gap-3">
      {COUNTERS.map(({ key, dot, value }) => (
        <Card key={key} className="gap-2 px-4 py-3.5">
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", dot)} />
            {t(`connections.stats.${key}`)}
          </div>
          <span className={cn("text-xl font-bold tabular-nums", value)}>
            {stats[key]}
          </span>
        </Card>
      ))}
      <Card className="gap-2 px-4 py-3.5">
        <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Clock className="size-3" />
          {t("connections.stats.lastSync")}
        </div>
        <span className="truncate text-base font-semibold">{synced}</span>
      </Card>
    </div>
  )
}
