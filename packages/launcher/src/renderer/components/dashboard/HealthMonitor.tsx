import React from "react"
import { useTranslation } from "react-i18next"

import { Card } from "../ui/card"
import { cn } from "../../lib/utils"
import type { Agent } from "../../types"
import { stateKeyOf } from "./agent-state"

type Bucket = "healthy" | "warning" | "offline"

const BUCKETS: Bucket[] = ["healthy", "warning", "offline"]

const DOT_CLASS: Record<Bucket, string> = {
  healthy: "bg-success",
  warning: "bg-warning",
  offline: "bg-muted-foreground",
}

function bucketOf(agent: Agent): Bucket {
  const key = stateKeyOf(agent)
  if (key === "running" || key === "idle") return "healthy"
  if (key === "error" || key === "starting") return "warning"
  return "offline"
}

/** Geometry of the gauge ring, in the SVG's own 100×100 user units. */
const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function HealthMonitor({ agents }: { agents: Agent[] }): React.JSX.Element {
  const { t } = useTranslation()

  const counts: Record<Bucket, number> = { healthy: 0, warning: 0, offline: 0 }
  for (const a of agents) counts[bucketOf(a)] += 1

  // A warning counts half: the agent is reachable but not doing useful work.
  const score = agents.length
    ? Math.round(((counts.healthy + counts.warning * 0.5) / agents.length) * 100)
    : 0
  const ringClass =
    score >= 80 ? "stroke-success" : score >= 50 ? "stroke-warning" : "stroke-destructive"

  return (
    <Card className="gap-3 px-4 py-3.5">
      <h3 className="text-sm font-semibold">{t("dashboard.health.title")}</h3>

      {agents.length === 0 ? (
        <p className="py-6 text-center text-2xs text-muted-foreground">
          {t("dashboard.health.empty")}
        </p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <svg viewBox="0 0 100 100" className="size-24 -rotate-90">
              <circle
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                strokeWidth="9"
                className="stroke-muted"
              />
              <circle
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - score / 100)}
                className={ringClass}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl leading-none font-bold">{score}</span>
              <span className="mt-0.5 text-3xs text-muted-foreground">
                {t("dashboard.health.score")}
              </span>
            </div>
          </div>

          <ul className="m-0 flex flex-1 list-none flex-col gap-2 p-0">
            {BUCKETS.map((b) => (
              <li key={b} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2">
                  <span
                    className={cn("size-1.5 rounded-full", DOT_CLASS[b])}
                  />
                  {t(`dashboard.health.buckets.${b}`)}
                </span>
                <span className="font-medium">{counts[b]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
