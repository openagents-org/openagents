import React from "react"
import ReactDOM from "react-dom"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { useUiStore } from "../../store/ui"
import { capture } from "../../lib/analytics"

/**
 * Lightweight spotlight "coach mark" tour that orients a new user to the real
 * sidebar in the order they should actually work: browse the marketplace →
 * create/configure an agent → open a workspace. It dims the screen, cuts a
 * hole around the targeted sidebar item, and shows a short instruction bubble
 * beside it — switching tabs as it advances so the matching page is visible
 * behind the spotlight.
 *
 * It complements (does not replace) the provisioning wizard (OnboardingFlow):
 * the wizard does the work, this tour teaches where things live. Completion is
 * persisted in localStorage so it only auto-runs once; it can be replayed from
 * the sidebar "guide" button.
 */

const TOUR_KEY = "guided_tour_completed"

export function shouldShowGuidedTour(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) !== "true"
  } catch {
    return false
  }
}

function markTourComplete(): void {
  try {
    localStorage.setItem(TOUR_KEY, "true")
  } catch {}
}

interface TourStep {
  /** Sidebar tab to switch to so the relevant page shows behind the spotlight. */
  tab: string
  /** data-tour anchor on the sidebar item to highlight. */
  anchor: string
  /** i18n key under `onboarding.tour.steps.<key>`. */
  key: string
}

// Labels/bodies live in the i18n catalog under `onboarding.tour.steps.<key>`;
// here we only keep the tab/anchor wiring so the list stays language-agnostic.
const STEPS: TourStep[] = [
  { tab: "dashboard", anchor: "dashboard", key: "dashboard" },
  { tab: "install", anchor: "install", key: "install" },
  { tab: "agents", anchor: "agents", key: "agents" },
  { tab: "workspaces", anchor: "workspaces", key: "workspaces" },
]

const PADDING = 6

export function GuidedTour(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { tourOpen, endTour, setCurrentTab } = useUiStore(
    useShallow((s) => ({
      tourOpen: s.tourOpen,
      endTour: s.endTour,
      setCurrentTab: s.setCurrentTab,
    })),
  )
  const [step, setStep] = React.useState(0)
  const [rect, setRect] = React.useState<DOMRect | null>(null)

  const current = STEPS[step]

  // Reset to the first step every time the tour (re)opens.
  React.useEffect(() => {
    if (tourOpen) {
      setStep(0)
      capture("guided_tour_started")
    }
  }, [tourOpen])

  // Switch the underlying tab so the matching page is visible behind the mask.
  React.useEffect(() => {
    if (tourOpen && current) setCurrentTab(current.tab)
  }, [tourOpen, current, setCurrentTab])

  // Measure the highlighted sidebar item. Re-measure after the tab switch /
  // layout settles (rAF) and on resize.
  React.useEffect(() => {
    if (!tourOpen || !current) return
    let raf = 0
    const measure = (): void => {
      const el = document.querySelector(`[data-tour="${current.anchor}"]`)
      if (el) setRect(el.getBoundingClientRect())
    }
    measure()
    raf = requestAnimationFrame(() => requestAnimationFrame(measure))
    window.addEventListener("resize", measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", measure)
    }
  }, [tourOpen, current])

  const finish = React.useCallback(
    (completed: boolean): void => {
      markTourComplete()
      capture(completed ? "guided_tour_completed" : "guided_tour_skipped", {
        step,
      })
      endTour()
    },
    [endTour, step],
  )

  // Allow Esc to dismiss.
  React.useEffect(() => {
    if (!tourOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") finish(false)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [tourOpen, finish])

  if (!tourOpen || !current) return null

  const isLast = step === STEPS.length - 1
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Spotlight hole around the target (fall back to a left-edge sliver so the
  // bubble still shows even if the anchor can't be measured).
  const hole = rect
    ? {
        top: Math.max(0, rect.top - PADDING),
        left: Math.max(0, rect.left - PADDING),
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
      }
    : { top: 80, left: 8, width: 220, height: 44 }

  // Bubble sits to the right of the highlighted sidebar item, clamped to the
  // viewport vertically.
  const BUBBLE_W = 320
  const bubbleLeft = Math.min(hole.left + hole.width + 14, vw - BUBBLE_W - 16)
  const bubbleTop = Math.min(Math.max(hole.top - 4, 16), vh - 220)

  const overlay = (
    <div className="fixed inset-0 z-2000" role="dialog" aria-modal="true">
      {/* Four dark panels around the hole — they block clicks; the hole lets
          the user click the highlighted item if they want. */}
      <div
        className="absolute left-0 right-0 top-0 bg-black/65"
        style={{ height: hole.top }}
      />
      <div
        className="absolute left-0 bg-black/65"
        style={{ top: hole.top, width: hole.left, height: hole.height }}
      />
      <div
        className="absolute right-0 bg-black/65"
        style={{
          top: hole.top,
          left: hole.left + hole.width,
          height: hole.height,
        }}
      />
      <div
        className="absolute left-0 right-0 bg-black/65"
        style={{ top: hole.top + hole.height, bottom: 0 }}
      />

      {/* Highlight ring around the target. */}
      <div
        className="absolute rounded-lg pointer-events-none ring-2 ring-[#6366f1] shadow-[0_0_0_4px_rgba(99,102,241,0.25)] transition-all duration-150"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
        }}
      />

      {/* Instruction bubble. */}
      <div
        className="absolute w-80 rounded-xl bg-(--bg-card) text-(--text-primary) border border-(--border) shadow-2xl p-4"
        style={{ top: bubbleTop, left: bubbleLeft }}
      >
        <div className="flex items-center gap-1.5 mb-2">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={
                "h-1.5 rounded-full transition-all " +
                (i === step
                  ? "w-5 bg-[#6366f1]"
                  : i < step
                    ? "w-1.5 bg-[#6366f1]/60"
                    : "w-1.5 bg-(--border)")
              }
            />
          ))}
          <span className="ml-auto text-2xs text-(--text-tertiary)">
            {t("onboarding.tour.progress", {
              current: step + 1,
              total: STEPS.length,
            })}
          </span>
        </div>

        <div className="text-base font-semibold mb-1">
          {t(`onboarding.tour.steps.${current.key}.title`)}
        </div>
        <div className="text-xs leading-relaxed text-(--text-secondary)">
          {t(`onboarding.tour.steps.${current.key}.body`)}
        </div>

        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            onClick={() => finish(false)}
            className="text-xs text-(--text-tertiary) hover:text-(--text-secondary) bg-transparent border-0 cursor-pointer"
          >
            {t("onboarding.tour.skip")}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="px-3 py-1.5 text-xs rounded-md border border-(--border) bg-transparent text-(--text-secondary) hover:text-(--text-primary) cursor-pointer"
              >
                {t("onboarding.tour.back")}
              </button>
            )}
            <button
              type="button"
              onClick={() => (isLast ? finish(true) : setStep((s) => s + 1))}
              className="px-3.5 py-1.5 text-xs font-medium rounded-md border-0 bg-[#6366f1] text-white hover:bg-[#4f46e5] cursor-pointer"
            >
              {isLast
                ? t("onboarding.tour.getStarted")
                : t("onboarding.tour.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return ReactDOM.createPortal(overlay, document.body)
}
