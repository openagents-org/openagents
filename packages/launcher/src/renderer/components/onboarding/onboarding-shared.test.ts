import { describe, it, expect, beforeEach } from "vitest"

import {
  ONBOARDING_KEY,
  TOUR_KEY,
  markGuidedTourSeen,
  resetGuidedTour,
  resetOnboardingProgress,
  shouldShowGuidedTour,
} from "./onboarding-shared"

describe("guided tour gating", () => {
  beforeEach(() => localStorage.clear())

  it("runs for a fresh install", () => {
    expect(shouldShowGuidedTour()).toBe(true)
  })

  it("stays away once seen", () => {
    markGuidedTourSeen()
    expect(shouldShowGuidedTour()).toBe(false)
  })

  // The regression: the tour's mark lives under its own key, so wiping the
  // wizard's progress alone left it suppressed forever — onboarding replayed,
  // finished, and nothing popped after it.
  it("comes back when onboarding is replayed", () => {
    markGuidedTourSeen()
    localStorage.setItem(ONBOARDING_KEY, "true")

    resetOnboardingProgress()
    expect(shouldShowGuidedTour()).toBe(false)

    resetGuidedTour()
    expect(shouldShowGuidedTour()).toBe(true)
  })

  it("resetOnboardingProgress leaves the tour mark for it to clear", () => {
    markGuidedTourSeen()
    resetOnboardingProgress()
    expect(localStorage.getItem(ONBOARDING_KEY)).toBeNull()
    expect(localStorage.getItem(TOUR_KEY)).toBe("true")
  })
})
