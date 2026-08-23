import { describe, it, expect } from "vitest"

import { ONBOARDING_STEPS } from "./onboarding-shared"
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
})
