import * as React from "react"

import { cn } from "@renderer/lib/utils"
import type { AgentState } from "@renderer/types"

export type StatusTone = "online" | "starting" | "offline"

/** Collapses the many agent lifecycle states into the three visual tones. */
export function statusClass(state: string): StatusTone {
  if (["online", "running", "idle"].includes(state)) return "online"
  if (["starting", "reconnecting"].includes(state)) return "starting"
  return "offline"
}

/** `idle` is an internal name; users read it as "running". */
export function displayState(state: string): string {
  return state === "idle" ? "running" : state || "stopped"
}

const TONE: Record<StatusTone, string> = {
  // `ring` draws the soft halo the legacy shadow used to paint by hand.
  online: "bg-success ring-3 ring-success/15",
  starting: "bg-warning animate-pulse-dot",
  offline: "bg-muted-foreground",
}

export interface StatusDotProps {
  state: AgentState | string
  className?: string
}

export function StatusDot({ state, className }: StatusDotProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        TONE[statusClass(state)],
        className,
      )}
    />
  )
}
