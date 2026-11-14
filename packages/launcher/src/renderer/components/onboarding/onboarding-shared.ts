export type StepId =
  | "welcome"
  | "pairNode"
  | "agent"
  | "configure"
  | "createAgent"
  | "memory"

/**
 * One flow, pairing first: welcome → pair → (optionally) pick, configure and
 * create a local agent bound to the paired workspace. Everything after the
 * pairing step is an optional continuation — pairing alone is a complete
 * onboarding, because the workspace installs agents on this device remotely.
 * Each id keys the step title (`onboarding.flow.progress.<id>`) and its
 * one-line rail description (`onboarding.flow.rail.steps.<id>`).
 */
export const ONBOARDING_STEPS: readonly StepId[] = [
  "welcome",
  "pairNode",
  "agent",
  "configure",
  "createAgent",
  "memory",
]

/**
 * Where the optional continuation starts. Everything from here on only happens
 * if the user asks for it from the paired panel, so the rail and the dots stop
 * short of it until they do: a tracker that promises three more steps to
 * someone who is about to press "Finish setup" is counting work that will never
 * happen, and makes a finished setup look abandoned.
 */
export const OPTIONAL_STEPS_FROM = 2

/**
 * The steps to show while the user sits at `index`. The optional continuation
 * appears only once they are actually in it — before that the tracker shows the
 * path they have committed to, which pairing alone completes.
 */
export function visibleSteps(index: number, withMemory = false): readonly StepId[] {
  if (index < OPTIONAL_STEPS_FROM) return ONBOARDING_STEPS.slice(0, OPTIONAL_STEPS_FROM)
  // "Bring your memory" only exists for agents whose tool keeps memory we can
  // read (Claude Code, Codex, OpenClaw); for any other agent the flow ends at
  // createAgent and the tracker must not promise a step that never comes.
  return withMemory || index >= ONBOARDING_STEPS.indexOf("memory")
    ? ONBOARDING_STEPS
    : ONBOARDING_STEPS.filter((s) => s !== "memory")
}

/** Agent types the memory step can import for (connector memory-import.js). */
export const MEMORY_IMPORT_TYPES: ReadonlySet<string> = new Set(["claude", "codex", "openclaw"])

/** Human-readable step names so the funnel reads clearly in PostHog. */
export const STEP_NAMES: Record<StepId, string> = {
  welcome: "welcome",
  pairNode: "pair_node",
  agent: "select_agent",
  configure: "configure",
  createAgent: "create_agent",
  memory: "bring_memory",
}

export const ONBOARDING_KEY = "onboarding_completed"
export const STEP_KEY = "onboarding_step"
export const MODE_KEY = "onboarding_mode"
export const SELECTED_AGENT_KEY = "last_selected_agent"
/** The agent the memory step is for, so a resumed session lands on it. */
export const MEMORY_AGENT_KEY = "onboarding_memory_agent"
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
