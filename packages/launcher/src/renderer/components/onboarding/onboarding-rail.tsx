import React from "react"
import { Check } from "lucide-react"
import { useTranslation } from "react-i18next"

import { BrandMark } from "@renderer/components/ui-kit"
import { cn } from "@renderer/lib/utils"

import { STEP_IDS, type Step } from "./onboarding-shared"

/**
 * The wizard's left rail: brand and the vertical step tracker. It paints the
 * fixed dark sidebar surface in both themes, the same way the app rail frames
 * the main window.
 */
export function OnboardingRail({ step }: { step: Step }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-7 py-7 lg:flex xl:w-80">
      <div className="flex items-center gap-2.5">
        <BrandMark className="size-8 rounded-lg" />
        <span className="text-lg font-bold tracking-tight text-sidebar-accent-foreground">
          OpenAgents Launcher
        </span>
      </div>

      <ol className="m-0 mt-10 list-none p-0">
        {STEP_IDS.map((id, i) => {
          const done = i < step
          const current = i === step
          const last = i === STEP_IDS.length - 1
          return (
            <li key={id} className="flex gap-3.5">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full font-mono text-2xs font-bold transition-colors",
                    done && "bg-sidebar-primary/20 text-sidebar-primary",
                    current &&
                      "bg-sidebar-primary text-sidebar-primary-foreground",
                    !done && !current && "bg-white/5 text-sidebar-muted",
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
                      done ? "bg-sidebar-primary/40" : "bg-sidebar-border",
                    )}
                  />
                )}
              </div>
              <div className={cn("min-w-0", !last && "pb-7")}>
                <div
                  className={cn(
                    "text-sm font-semibold",
                    done || current
                      ? "text-sidebar-accent-foreground"
                      : "text-sidebar-muted",
                  )}
                >
                  {t(`onboarding.flow.progress.${id}`)}
                </div>
                <p className="m-0 mt-1 text-2xs leading-relaxed text-sidebar-muted">
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
