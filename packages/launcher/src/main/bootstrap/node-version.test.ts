import { describe, expect, it } from "vitest"

import {
  LEGACY_NODE_VERSION,
  NODE_VERSION,
  needsNodeUpgrade,
  parseVersion,
  pinnedNodeVersion,
} from "./node-version"

describe("pinnedNodeVersion", () => {
  it("gives Windows and Linux the current runtime", () => {
    expect(pinnedNodeVersion("win32", "10.0.19045")).toBe(NODE_VERSION)
    expect(pinnedNodeVersion("linux", "5.15.0-91-generic")).toBe(NODE_VERSION)
  })

  // Node 24's floor is macOS 13.5 = Darwin 22.6.0.
  it.each([
    ["21.6.0", LEGACY_NODE_VERSION], // macOS 12
    ["22.5.0", LEGACY_NODE_VERSION], // macOS 13.4
    ["22.6.0", NODE_VERSION], // macOS 13.5
    ["25.6.0", NODE_VERSION], // macOS 26
    ["not-a-version", NODE_VERSION],
  ])("darwin %s → %s", (release, expected) => {
    expect(pinnedNodeVersion("darwin", release)).toBe(expected)
  })
})

describe("needsNodeUpgrade", () => {
  it("upgrades a Node 22 runtime to the pin", () => {
    expect(needsNodeUpgrade("v22.22.3", "v24.21.0")).toBe(true)
    expect(needsNodeUpgrade("v24.20.0", "v24.21.0")).toBe(true)
  })

  it("leaves a runtime at or past the pin alone", () => {
    expect(needsNodeUpgrade("v24.21.0", "v24.21.0")).toBe(false)
    expect(needsNodeUpgrade("v26.1.0", "v24.21.0")).toBe(false)
    // An old Mac pinned to 22 is not asked to move.
    expect(needsNodeUpgrade("v22.22.3", LEGACY_NODE_VERSION)).toBe(false)
  })

  it("does not act on a version it cannot read", () => {
    expect(needsNodeUpgrade(null, "v24.21.0")).toBe(false)
    expect(needsNodeUpgrade("garbage", "v24.21.0")).toBe(false)
  })
})

describe("parseVersion", () => {
  it("reads node and Darwin version strings", () => {
    expect(parseVersion("v24.21.0\n")).toEqual([24, 21, 0])
    expect(parseVersion("22.6.0")).toEqual([22, 6, 0])
    expect(parseVersion("")).toBeNull()
  })
})
