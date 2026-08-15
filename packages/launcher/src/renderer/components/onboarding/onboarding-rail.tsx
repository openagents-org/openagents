import React from "react"
import { Check } from "lucide-react"
import { useTranslation } from "react-i18next"

import { BrandMark } from "@renderer/components/ui-kit"
import { cn } from "@renderer/lib/utils"

import type { StepId } from "./onboarding-shared"

/**
 * The wizard's left rail: brand and the vertical step tracker.
 *
 * Painted from the always-dark `panel` tokens, so it stays dark in both themes.
 * Unlike the app rail — which now follows the theme — this one frames a
 * full-screen, one-time flow with no app around it to disagree with.
 */
export function OnboardingRail({
  steps,
  step,
}: {
  /** The active path's steps — the two modes walk different ones. */
  steps: readonly StepId[]
  step: number
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <aside className="panel-dark hidden w-72 shrink-0 flex-col border-r border-panel-border bg-panel px-7 py-7 lg:flex xl:w-80">
      {/* macOS puts its traffic lights over this corner. A spacer on top of the
          rail's own padding, not instead of it: the inset is zero in full screen
          and on the platforms whose buttons are over the content area, and the
          brand still wants its 28px in every one of those cases. */}
      <div aria-hidden className="h-(--rail-top-inset) shrink-0" />
      <div className="flex items-center gap-2.5">
        <BrandMark variant="white" className="size-8 rounded-lg" />
        <span className="text-lg font-bold tracking-tight text-panel-accent-foreground">
          {t("common.appName")}
        </span>
      </div>

      <ol className="m-0 mt-10 list-none p-0">
        {steps.map((id, i) => {
          const done = i < step
          const current = i === step
          const last = i === steps.length - 1
          return (
            <li key={id} className="flex gap-3.5">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full font-mono text-2xs font-bold transition-colors",
                    done && "bg-panel-primary/20 text-panel-primary",
                    current &&
                      "bg-panel-primary text-panel-primary-foreground",
                    !done && !current && "bg-white/5 text-panel-muted",
                  )}
                >
                  {done ? (
                    <Check className="size-3.5" />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                {!last && (
                  <span
                    className={cn(
                      "my-1.5 w-px flex-1",
                      done ? "bg-panel-primary/40" : "bg-panel-border",
                    )}
                  />
                )}
              </div>
              <div className={cn("min-w-0", !last && "pb-7")}>
                <div
                  className={cn(
                    "text-sm font-semibold",
                    done || current
                      ? "text-panel-accent-foreground"
                      : "text-panel-muted",
                  )}
                >
                  {t(`onboarding.flow.progress.${id}`)}
                </div>
                <p className="m-0 mt-1 text-2xs leading-relaxed text-panel-muted">
                  {t(`onboarding.flow.rail.steps.${id}`)}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
