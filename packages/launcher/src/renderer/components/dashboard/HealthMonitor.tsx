import React from "react"
import { useTranslation } from "react-i18next"

import { Card } from "../shadcn/card"
import { StatusDot, displayState } from "../ui-kit"
import { cn } from "../../lib/utils"
import type { Agent } from "../../types"

type Bucket = "healthy" | "busy" | "warning" | "offline" | "error"

function bucketOf(a: Agent): Bucket {
  if (a.state === "error" || a.lastError) return "error"
  if (a.state === "starting" || a.state === "reconnecting") return "warning"
  if (["running", "online"].includes(a.state)) return "healthy"
  if (a.state === "idle") return "busy"
  return "offline"
}

/** Tile tint per bucket — background and text move together. */
const BUCKET_CLASS: Record<Bucket, string> = {
  healthy: "bg-(--success-bg) text-(--success-text)",
  busy: "bg-primary/10 text-primary",
  warning: "bg-(--warning-bg) text-(--warning-text)",
  offline: "bg-muted text-muted-foreground",
  error: "bg-(--danger-bg) text-(--danger-text)",
}

const BUCKETS = Object.keys(BUCKET_CLASS) as Bucket[]

export function HealthMonitor({
  agents,
  onSelect,
}: {
  agents: Agent[]
  onSelect?: (name: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const counts = BUCKETS.reduce(
    (acc, b) => ({ ...acc, [b]: 0 }),
    {} as Record<Bucket, number>,
  )
  for (const a of agents) counts[bucketOf(a)] += 1

  return (
    <Card className="h-full gap-3 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("dashboard.health.title")}</h3>
        <span className="text-3xs text-muted-foreground">
          {t("dashboard.health.agentCount", { count: agents.length })}
        </span>
      </div>

      <div className="grid shrink-0 grid-cols-5 gap-2">
        {BUCKETS.map((b) => (
          <div
            key={b}
            className={cn("rounded-md px-2.5 py-2 text-center", BUCKET_CLASS[b])}
          >
            <div className="text-lg leading-tight font-bold">{counts[b]}</div>
            <div className="mt-0.5 text-3xs">
              {t(`dashboard.health.buckets.${b}`)}
            </div>
          </div>
        ))}
      </div>

      {agents.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-3 text-center text-2xs text-muted-foreground">
          {t("dashboard.health.empty")}
        </p>
      ) : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-1 overflow-y-auto p-0">
          {agents.map((a) => (
            <li
              key={a.name}
              onClick={() => onSelect?.(a.name)}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
            >
              <div className="flex min-w-0 items-center gap-2">
                <StatusDot state={a.state} />
                <span className="truncate">{a.name}</span>
                <span className="shrink-0 text-3xs text-muted-foreground">
                  {a.type}
                </span>
              </div>
              <span className="shrink-0 text-3xs text-muted-foreground">
                {displayState(a.state)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
