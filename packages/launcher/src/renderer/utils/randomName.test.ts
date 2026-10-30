import { describe, expect, it } from "vitest"

import { randomAgentName } from "./randomName"

/** The charset the daemon accepts for an agent name. */
const VALID = /^[a-zA-Z0-9_-]+$/

describe("randomAgentName", () => {
  it("leads with the agent type so a list says what each agent is", () => {
    for (const type of ["claude", "commandcode", "opencode"]) {
      const name = randomAgentName(type)
      expect(name.startsWith(`${type}-`)).toBe(true)
      expect(name).toMatch(VALID)
    }
  })

  it("still varies within a type, so a second agent never collides", () => {
    // The fixed "my-<type>" this replaced produced the same name every time.
    const names = new Set(Array.from({ length: 40 }, () => randomAgentName("claude")))
    expect(names.size).toBeGreaterThan(1)
  })

  it("falls back to a numbered name when no type is given", () => {
    const name = randomAgentName()
    expect(name).toMatch(/^[a-z]+-[a-z]+-\d{2}$/)
  })

  it("treats a blank type as no type at all", () => {
    for (const blank of ["", "   ", undefined]) {
      expect(randomAgentName(blank)).toMatch(/^[a-z]+-[a-z]+-\d{2}$/)
    }
  })

  it("strips characters the daemon would reject rather than emitting them", () => {
    // Registry-sourced, but a stray character would fail at create time.
    const name = randomAgentName("my agent!/v2")
    expect(name).toMatch(VALID)
    expect(name.startsWith("myagentv2-")).toBe(true)
  })
})
