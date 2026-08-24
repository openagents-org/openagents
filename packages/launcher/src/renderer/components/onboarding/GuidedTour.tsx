import React from "react"
import ReactDOM from "react-dom"
import { type LucideIcon } from "lucide-react"
import { useShallow } from "zustand/react/shallow"

import { NAV_ITEMS } from "@renderer/components/layout/nav-config"

import { useUiStore } from "../../store/ui"
import { capture } from "../../lib/analytics"
import { markGuidedTourSeen } from "./onboarding-shared"
import { TourBubble, TOUR_TITLE_ID } from "./tour-bubble"
import { useTourSpotlight } from "./use-tour-spotlight"

/**
 * Lightweight spotlight "coach mark" tour that orients a new user to the real
 * sidebar in the order they should actually work: install an agent → run it
 * and send it into a workspace → join further workspaces as needed. It dims
 * the screen, cuts a hole around the targeted sidebar item, and shows a short
 * instruction bubble beside it — switching tabs as it advances so the matching
 * page is visible behind the spotlight.
 *
 * It complements (does not replace) the provisioning wizard (OnboardingFlow):
 * the wizard does the work, this tour teaches where things live. Completion is
 * persisted in localStorage so it only auto-runs once; it can be replayed from
 * the sidebar "guide" button.
 */

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
//
// The wizard this tour follows has already joined the first workspace, so
// Workspaces comes last: it is where a device joins the next one, not where it
// starts.
const STEPS: TourStep[] = [
  { tab: "dashboard", anchor: "dashboard", key: "dashboard" },
  { tab: "install", anchor: "install", key: "install" },
  { tab: "agents", anchor: "agents", key: "agents" },
  { tab: "workspaces", anchor: "workspaces", key: "workspaces" },
]

/** The rail's own icon for the highlighted item, so the bubble names it twice. */
function stepIcon(anchor: string): LucideIcon | null {
  return NAV_ITEMS.find((i) => i.id === anchor)?.icon ?? null
}

/** Gap between the cut-out and the bubble, and the bubble's viewport margin. */
const GAP = 14
const MARGIN = 16

export function GuidedTour(): React.JSX.Element | null {
  const { tourOpen, endTour, setCurrentTab } = useUiStore(
    useShallow((s) => ({
      tourOpen: s.tourOpen,
      endTour: s.endTour,
      setCurrentTab: s.setCurrentTab,
    })),
  )
  const [step, setStep] = React.useState(0)

  // Rewind during render, not in an effect: replaying the tour from the rail's
  // "guide" entry would otherwise paint one frame of whichever step it was left
  // on before snapping back to the first.
  const [wasOpen, setWasOpen] = React.useState(tourOpen)
  if (tourOpen !== wasOpen) {
    setWasOpen(tourOpen)
    if (tourOpen) setStep(0)
  }

  const current = tourOpen ? STEPS[step] : undefined
  const { hole, vw, vh } = useTourSpotlight(current?.anchor ?? null)

  React.useEffect(() => {
    if (tourOpen) capture("guided_tour_started")
  }, [tourOpen])

  // Switch the underlying tab so the matching page is visible behind the mask.
  React.useEffect(() => {
    if (tourOpen && current) setCurrentTab(current.tab)
  }, [tourOpen, current, setCurrentTab])

  const finish = React.useCallback(
    (completed: boolean): void => {
      markGuidedTourSeen()
      capture(completed ? "guided_tour_completed" : "guided_tour_skipped", {
        step,
      })
      endTour()
    },
    [endTour, step],
  )

  const isLast = step === STEPS.length - 1
  const back = React.useCallback(() => setStep((s) => Math.max(0, s - 1)), [])
  const next = React.useCallback(() => {
    if (isLast) finish(true)
    else setStep((s) => s + 1)
  }, [isLast, finish])

  // Esc dismisses; arrows walk the steps.
  React.useEffect(() => {
    if (!tourOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") finish(false)
      else if (e.key === "ArrowRight") next()
      else if (e.key === "ArrowLeft") back()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [tourOpen, finish, next, back])

  // The bubble is measured rather than assumed: every size in the app is
  // rem-based and Settings → Appearance rescales the root font, so hardcoded
  // dimensions would clamp against the wrong numbers at any scale but 100%.
  // Observing the node covers the rest of what resizes it — the step's own
  // text, and a language switch.
  const [bubble, setBubble] = React.useState({ w: 0, h: 0 })
  const bubbleRef = React.useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const sync = (): void =>
      setBubble((b) => {
        const w = el.offsetWidth
        const h = el.offsetHeight
        return b.w === w && b.h === h ? b : { w, h }
      })
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!tourOpen || !current) return null

  // The bubble sits to the right of the rail item, centred on it and clamped
  // into the viewport. The rail is always the leftmost column, so "right of the
  // hole" never needs a flipped placement.
  const left = Math.min(hole.left + hole.width + GAP, vw - bubble.w - MARGIN)
  const top = Math.min(
    Math.max(hole.top + hole.height / 2 - bubble.h / 2, MARGIN),
    Math.max(MARGIN, vh - bubble.h - MARGIN),
  )
  // Keep the pointer on the hole even after the bubble has been clamped away
  // from it, staying clear of the rounded corners.
  const arrowTop = Math.min(
    Math.max(hole.top + hole.height / 2 - top, GAP),
    Math.max(GAP, bubble.h - GAP),
  )
  const Icon = stepIcon(current.anchor)

  const overlay = (
    <div
      className="fixed inset-0 z-2000 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby={TOUR_TITLE_ID}
    >
      {/* Four panels around the hole rather than one overlay: they block every
          stray click while the hole itself stays live, so a user can act on the
          highlighted item mid-tour. */}
      <div
        className="absolute inset-x-0 top-0 bg-black/60"
        style={{ height: hole.top }}
      />
      <div
        className="absolute left-0 bg-black/60"
        style={{ top: hole.top, width: hole.left, height: hole.height }}
      />
      <div
        className="absolute right-0 bg-black/60"
        style={{
          top: hole.top,
          left: hole.left + hole.width,
          height: hole.height,
        }}
      />
      <div
        className="absolute inset-x-0 bg-black/60"
        style={{ top: hole.top + hole.height, bottom: 0 }}
      />

      {/* Ring plus halo in ONE box-shadow: Tailwind's `ring-*` compiles to
          box-shadow too, so a style-level shadow beside it would win outright
          and erase the ring. */}
      <div
        className="pointer-events-none absolute rounded-lg transition-all duration-200"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          boxShadow:
            "0 0 0 2px var(--accent), 0 0 0 6px var(--accent-border)",
        }}
      />

      <TourBubble
        ref={bubbleRef}
        stepKey={current.key}
        icon={stepIcon(current.anchor)}
        index={step}
        total={STEPS.length}
        arrowTop={arrowTop}
        style={{ top, left }}
        onSkip={() => finish(false)}
        onBack={back}
        onNext={next}
      />
    </div>
  )

  return ReactDOM.createPortal(overlay, document.body)
}
