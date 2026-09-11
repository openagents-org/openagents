import { describe, expect, it } from "vitest"

import { nodeSatisfies } from "./node-engines"

// The ranges openclaw actually published either side of its move to Node 24:
// 2026.9.2 still ran on the launcher's bundled Node 22.22.3, 2026.9.3 did not.
const OPENCLAW_9_2 = ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0"
const OPENCLAW_9_3 = ">=24.16.0 <25 || >=26.1.0"

describe("nodeSatisfies", () => {
  it("reads openclaw's ranges the way npm does", () => {
    expect(nodeSatisfies("22.22.3", OPENCLAW_9_2)).toBe(true)
    expect(nodeSatisfies("22.22.3", OPENCLAW_9_3)).toBe(false)
    expect(nodeSatisfies("24.20.0", OPENCLAW_9_3)).toBe(true)
    expect(nodeSatisfies("25.0.0", OPENCLAW_9_3)).toBe(false)
    expect(nodeSatisfies("v26.1.0", OPENCLAW_9_3)).toBe(true)
  })

  it.each([
    ["22.22.3", ">=22.19.0", true],
    ["20.11.0", ">= 22", false],
    ["22.0.0", "22.x", true],
    ["23.0.0", "22", false],
    ["22.5.1", "^22.1.0", true],
    ["23.0.0", "^22.1.0", false],
    ["0.3.0", "^0.2.3", false],
    ["22.2.0", "~22.1.0", false],
    ["22.1.9", "~22.1", true],
    ["22.9.0", "18 - 22", true],
    ["23.0.0", "18 - 22", false],
    ["22.22.3", "<=22.22.3", true],
    ["22.22.4", "<=22.22.3", false],
    ["22.22.3", ">22.22", false],
    ["22.23.0", ">22.22", true],
    ["22.0.0", "=22.0.0", true],
    ["22.0.0", "*", true],
    ["22.0.0", "", true],
  ])("%s against %j is %s", (version, range, expected) => {
    expect(nodeSatisfies(version, range)).toBe(expected)
  })

  it("says it can't tell rather than guessing no", () => {
    // A "no" holds an agent back on an older release, so it has to be earned —
    // a range nobody here can read is not evidence against the Node.
    expect(nodeSatisfies("22.22.3", ">=22.0.0-rc.1")).toBe(null)
    expect(nodeSatisfies("22.22.3", "node >= 18")).toBe(null)
    expect(nodeSatisfies("nightly", ">=18")).toBe(null)
  })

  it("answers yes when one alternative is unreadable and another fits", () => {
    expect(nodeSatisfies("22.22.3", ">=99.0.0-beta || >=22")).toBe(true)
    expect(nodeSatisfies("20.0.0", ">=99.0.0-beta || >=22")).toBe(null)
  })
})
