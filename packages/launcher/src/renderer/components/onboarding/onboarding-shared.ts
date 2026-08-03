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
