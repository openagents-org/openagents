/**
 * The two ways to start. `node` pairs this device with a workspace — one code,
 * nothing else to configure, and the workspace installs and runs agents here
 * afterwards — so it is the default. `agent` is the long path: pick an agent,
 * configure its credentials, create it locally.
 */
export type OnboardingMode = "node" | "agent"

export const DEFAULT_MODE: OnboardingMode = "node"

export type StepId =
  | "welcome"
  | "pairNode"
  | "agent"
  | "configure"
  | "createAgent"
  | "connectWorkspace"

/**
 * Rail order per mode. Each id keys the step title
 * (`onboarding.flow.progress.<id>`) and its one-line rail description
 * (`onboarding.flow.rail.steps.<id>`); the position in the array is the step
 * index the flow walks.
 */
export const MODE_STEPS: Record<OnboardingMode, readonly StepId[]> = {
  node: ["welcome", "pairNode"],
  agent: ["welcome", "agent", "configure", "createAgent", "connectWorkspace"],
}

/** Human-readable step names so the funnel reads clearly in PostHog. */
export const STEP_NAMES: Record<StepId, string> = {
  welcome: "welcome",
  pairNode: "pair_node",
  agent: "select_agent",
  configure: "configure",
  createAgent: "create_agent",
  connectWorkspace: "connect_workspace",
}

export const ONBOARDING_KEY = "onboarding_completed"
export const STEP_KEY = "onboarding_step"
export const MODE_KEY = "onboarding_mode"
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
    localStorage.removeItem(MODE_KEY)
    localStorage.removeItem(SELECTED_AGENT_KEY)
  } catch {}
}

/** The persisted path, falling back to the default for anything unknown. */
export function readMode(): OnboardingMode {
  try {
    const raw = localStorage.getItem(MODE_KEY)
    return raw === "agent" || raw === "node" ? raw : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
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
