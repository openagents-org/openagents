import { describe, it, expect } from "vitest"

import {
  MODE_KEY,
  MODE_STEPS,
  DEFAULT_MODE,
  readMode,
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

describe("onboarding mode", () => {
  it("defaults to pairing this device", () => {
    localStorage.clear()
    expect(readMode()).toBe(DEFAULT_MODE)
    expect(DEFAULT_MODE).toBe("node")
  })

  it("restores a persisted choice and ignores junk", () => {
    localStorage.setItem(MODE_KEY, "agent")
    expect(readMode()).toBe("agent")
    localStorage.setItem(MODE_KEY, "nonsense")
    expect(readMode()).toBe("node")
  })

  // Both paths start on Welcome — that shared first step is what makes the
  // mode switch there safe to do without moving the user.
  it("walks a shorter path when pairing", () => {
    expect(MODE_STEPS.node[0]).toBe("welcome")
    expect(MODE_STEPS.agent[0]).toBe("welcome")
    expect(MODE_STEPS.node).toHaveLength(2)
    expect(MODE_STEPS.agent.length).toBeGreaterThan(MODE_STEPS.node.length)
  })
})
