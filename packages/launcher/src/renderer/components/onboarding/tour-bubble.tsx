import React from "react"
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"

/** The heading the tour's dialog role points at. */
export const TOUR_TITLE_ID = "guided-tour-title"

/**
 * The instruction card beside the spotlight. Pure presentation: GuidedTour owns
 * the step machine and hands down the already-clamped position.
 */
export function TourBubble({
  ref,
  stepKey,
  icon: Icon,
  index,
  total,
  arrowTop,
  style,
  onSkip,
  onBack,
  onNext,
}: {
  ref: React.Ref<HTMLDivElement>
  /** i18n key under `onboarding.tour.steps.<key>`. */
  stepKey: string
  /** The rail's own icon for the highlighted item, so the bubble names it twice. */
  icon: LucideIcon | null
  index: number
  total: number
  /** Pointer offset from the bubble's top, in px. */
  arrowTop: number
  style: React.CSSProperties
  onSkip: () => void
  onBack: () => void
  onNext: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isLast = index === total - 1

  return (
    <div
      ref={ref}
      className="absolute w-80 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg transition-all duration-200"
      style={style}
    >
      {/* Pointer back at the highlighted item: a rotated square sharing the
          bubble's background, so only its two outer edges read as border. */}
      <span
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-l border-border bg-popover"
        style={{ top: arrowTop, left: 0 }}
        aria-hidden
      />

      <div className="flex items-center gap-2">
        {Icon && (
          <span className="flex size-6 items-center justify-center rounded-md bg-(--accent-bg) text-(--accent)">
            <Icon className="size-3.5" />
          </span>
        )}
        <span className="font-mono text-2xs tracking-widest text-muted-foreground uppercase">
          {t("onboarding.tour.progress", { current: index + 1, total })}
        </span>
      </div>

      <div id={TOUR_TITLE_ID} className="mt-3 text-base font-semibold">
        {t(`onboarding.tour.steps.${stepKey}.title`)}
      </div>
      <p className="mt-1.5 mb-0 text-xs leading-relaxed text-muted-foreground">
        {t(`onboarding.tour.steps.${stepKey}.body`)}
      </p>

      {/* Same dot tracker the wizard's footer uses, so the two halves of
          onboarding read as one flow. */}
      <div className="mt-4 flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === index
                ? "w-5 bg-(--accent)"
                : i < index
                  ? "w-1.5 bg-(--accent-border)"
                  : "w-1.5 bg-(--border-hover)",
            )}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onSkip}
        >
          {t("onboarding.tour.skip")}
        </Button>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button variant="outline" size="sm" onClick={onBack}>
              <ChevronLeft />
              {t("onboarding.tour.back")}
            </Button>
          )}
          <Button size="sm" onClick={onNext}>
            {isLast
              ? t("onboarding.tour.getStarted")
              : t("onboarding.tour.next")}
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
