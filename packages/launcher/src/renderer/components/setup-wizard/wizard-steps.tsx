import React from "react"
import { Check } from "lucide-react"

import { cn } from "@renderer/lib/utils"

/**
 * Horizontal step tracker. Same vocabulary as the onboarding rail — mono
 * two-digit numerals, a tick once a step is behind you — so the two setup
 * surfaces read as one flow rather than two generations of the app.
 */
export function WizardSteps({
  steps,
  current,
}: {
  steps: Array<{ key: string; label: string }>
  current: number
}): React.JSX.Element {
  return (
    <ol className="m-0 flex list-none items-center gap-2.5 p-0">
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <React.Fragment key={s.key}>
            {i > 0 && <span className="h-px flex-1 bg-border" />}
            <li className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full font-mono text-3xs font-bold",
                  done && "bg-success/15 text-success",
                  active && "bg-primary text-primary-foreground",
                  !done && !active && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" /> : String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={cn("text-2xs", active ? "font-semibold" : "text-muted-foreground")}
              >
                {s.label}
              </span>
            </li>
          </React.Fragment>
        )
      })}
    </ol>
  )
}
