import React from "react"
import { Check } from "lucide-react"

import { cn } from "@renderer/lib/utils"

/**
 * Horizontal step tracker, on its own tinted band directly under the dialog
 * header. Same vocabulary as the onboarding rail — mono two-digit numerals, a
 * tick once a step is behind you — so the two setup surfaces read as one flow
 * rather than two generations of the app.
 *
 * `meta` is the right-hand aside ("About a minute", "Last step"). It sets an
 * expectation for the whole flow, which is the one thing a two-step tracker
 * cannot say on its own.
 */
export function WizardSteps({
  steps,
  current,
  meta,
}: {
  steps: Array<{ key: string; label: string }>
  current: number
  meta?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-muted/60 px-4 py-3">
      <ol className="m-0 flex flex-1 list-none items-center gap-3 p-0">
        {steps.map((s, i) => {
          const done = i < current
          const active = i === current
          return (
            <React.Fragment key={s.key}>
              {/* The connector grows, the steps do not: it is the only part of
                  the row with nothing to say, so it absorbs the slack. */}
              {i > 0 && <span className="h-px max-w-32 flex-1 bg-border" />}
              <li className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full font-mono text-2xs font-bold transition-colors",
                    done && "bg-success/15 text-success",
                    active && "bg-primary text-primary-foreground",
                    !done && !active && "bg-background text-muted-foreground",
                  )}
                >
                  {done ? (
                    <Check className="size-3.5" strokeWidth={2.5} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <span
                  className={cn(
                    "text-xs",
                    active || done
                      ? "font-semibold"
                      : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </li>
            </React.Fragment>
          )
        })}
      </ol>
      {meta && (
        <span className="shrink-0 text-2xs text-muted-foreground">{meta}</span>
      )}
    </div>
  )
}
