export type Step = 0 | 1 | 2 | 3 | 4

/** Human-readable step names so the funnel reads clearly in PostHog. */
export const STEP_NAMES: Record<Step, string> = {
  0: "welcome",
  1: "select_agent",
  2: "configure",
  3: "create_agent",
  4: "connect_workspace",
}

/**
 * Rail order. The index IS the `Step`, and each id keys both the step title
 * (`onboarding.flow.progress.<id>`) and its one-line rail description
 * (`onboarding.flow.rail.steps.<id>`).
 */
export const STEP_IDS = [
  "welcome",
  "agent",
  "configure",
  "createAgent",
  "connectWorkspace",
] as const

export const ONBOARDING_KEY = "onboarding_completed"
export const STEP_KEY = "onboarding_step"
export const SELECTED_AGENT_KEY = "last_selected_agent"
/** The spotlight tour, which runs AFTER the wizard, has its own mark. */
export const TOUR_KEY = "guided_tour_completed"

export function shouldShowGuidedTour(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) !== "true"
  } catch {
    return false
  }
}

/** Stops the tour auto-running again — set whether it was finished or skipped. */
export function markGuidedTourSeen(): void {
  try {
    localStorage.setItem(TOUR_KEY, "true")
  } catch {}
}

/**
 * Clears that mark. Anyone about to walk the wizard is starting over, so the
 * tour has to start over with them: it lives under a key of its own and used to
 * survive every onboarding reset, which left a re-run ending in silence — the
 * wizard closed and nothing followed it.
 */
export function resetGuidedTour(): void {
  try {
    localStorage.removeItem(TOUR_KEY)
  } catch {}
}

/** Wipes the wizard's own progress so it replays from the top. */
export function resetOnboardingProgress(): void {
  try {
    localStorage.removeItem(ONBOARDING_KEY)
    localStorage.removeItem(STEP_KEY)
    localStorage.removeItem(SELECTED_AGENT_KEY)
  } catch {}
}

export const isWindows =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)

// Phase ids map to labels in the i18n catalog under
// `onboarding.flow.installPhase.<id>`; translated at render time.
export const INSTALL_PHASE_IDS = [
  "preparing",
  "downloading",
  "installing",
  "verifying",
  "done",
  "error",
] as const
