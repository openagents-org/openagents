import { describe, it, expect } from "vitest"

import {
  ONBOARDING_STEPS,
  OPTIONAL_STEPS_FROM,
  visibleSteps,
} from "./onboarding-shared"
import { formatCode, normalizeCode } from "@renderer/lib/pairing-code"

describe("pairing code input", () => {
  it("groups the code as the workspace prints it, while typing", () => {
    expect(formatCode("y")).toBe("Y")
    expect(formatCode("yaj8")).toBe("YAJ8")
    expect(formatCode("yaj89")).toBe("YAJ8-9")
    expect(formatCode("yaj8966m")).toBe("YAJ8-966M")
  })

  // Pasting the displayed form must not double up the separator, and a code
  // longer than 8 chars is truncated rather than sent and rejected.
  it("accepts a pasted, already-formatted code", () => {
    expect(formatCode("YAJ8-966M")).toBe("YAJ8-966M")
    expect(normalizeCode("YAJ8-966M")).toBe("YAJ8966M")
    expect(normalizeCode("YAJ8-966M-EXTRA")).toBe("YAJ8966M")
  })
})

describe("onboarding flow shape", () => {
  // One flow, pairing first: everything after pairNode is the optional
  // local-agent continuation, and there is no workspace step at the end —
  // createAgent binds to the paired workspace itself.
  it("leads with welcome → pairNode and ends at createAgent", () => {
    expect(ONBOARDING_STEPS[0]).toBe("welcome")
    expect(ONBOARDING_STEPS[1]).toBe("pairNode")
    expect(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]).toBe("createAgent")
    expect(ONBOARDING_STEPS).not.toContain("connectWorkspace")
  })

  // The tracker counts work the user has signed up for. Someone who pairs and
  // presses "Finish setup" never walks the last three, so promising them up
  // front made a complete setup look abandoned two steps in.
  it("hides the optional continuation until the user enters it", () => {
    expect(ONBOARDING_STEPS[OPTIONAL_STEPS_FROM]).toBe("agent")
    expect(visibleSteps(0)).toEqual(["welcome", "pairNode"])
    expect(visibleSteps(1)).toEqual(["welcome", "pairNode"])
    expect(visibleSteps(OPTIONAL_STEPS_FROM)).toEqual(ONBOARDING_STEPS)
    expect(visibleSteps(ONBOARDING_STEPS.length - 1)).toEqual(ONBOARDING_STEPS)
  })
})
