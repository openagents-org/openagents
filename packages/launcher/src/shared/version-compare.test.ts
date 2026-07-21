import { describe, it, expect } from "vitest"
import { compareVersions, isUpgradeAvailable } from "./version-compare"

describe("compareVersions", () => {
  it("orders by release numbers", () => {
    expect(compareVersions("0.46.0", "0.51.0")).toBeLessThan(0)
    expect(compareVersions("2.1.216", "2.1.202")).toBeGreaterThan(0)
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0)
  })

  it("treats missing segments as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0)
    expect(compareVersions("1.3", "1.2.9")).toBeGreaterThan(0)
  })

  it("compares numerically, not lexically", () => {
    // The bug a naive string compare would produce: "9" > "10".
    expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0)
    expect(compareVersions("0.139.0", "0.144.6")).toBeLessThan(0)
  })

  it("sorts a pre-release below its own release", () => {
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBeLessThan(0)
    expect(compareVersions("1.2.0", "1.2.0-beta.1")).toBeGreaterThan(0)
  })

  it("orders pre-release chains", () => {
    expect(compareVersions("1.2.0-beta.1", "1.2.0-beta.2")).toBeLessThan(0)
    expect(compareVersions("1.2.0-alpha", "1.2.0-beta")).toBeLessThan(0)
    // A longer chain outranks its own prefix.
    expect(compareVersions("1.2.0-beta", "1.2.0-beta.1")).toBeLessThan(0)
    // Numeric identifiers rank below alphanumeric ones.
    expect(compareVersions("1.2.0-1", "1.2.0-alpha")).toBeLessThan(0)
  })

  it("ignores build metadata and a leading v", () => {
    expect(compareVersions("1.2.3+build.9", "1.2.3")).toBe(0)
    expect(compareVersions("v1.2.4", "1.2.3")).toBeGreaterThan(0)
  })

  it("returns null for unparseable input", () => {
    expect(compareVersions("2026-07-21", "1.2.3")).toBeNull()
    expect(compareVersions("a1b2c3d", "1.2.3")).toBeNull()
  })
})

describe("isUpgradeAvailable", () => {
  it("offers the update the user is actually waiting for", () => {
    expect(isUpgradeAvailable("0.46.0", "0.51.0")).toBe(true)
    expect(isUpgradeAvailable("2.1.202", "2.1.216")).toBe(true)
  })

  it("stays quiet when already current", () => {
    expect(isUpgradeAvailable("0.51.0", "0.51.0")).toBe(false)
  })

  // The regression this function exists for: on the beta/nightly channel the
  // installed build is ahead of the stable dist-tag. `current !== latest` used
  // to advertise an "update" that downgrades — and since the strings still
  // differ afterwards, the prompt came back forever.
  it("never advertises a downgrade", () => {
    expect(isUpgradeAvailable("2.1.144-beta.3", "2.1.140")).toBe(false)
    expect(isUpgradeAvailable("0.52.0", "0.51.0")).toBe(false)
  })

  it("offers the stable release over a pre-release of the same version", () => {
    expect(isUpgradeAvailable("1.2.0-beta.1", "1.2.0")).toBe(true)
  })

  it("falls back to inequality for non-semver versions", () => {
    expect(isUpgradeAvailable("abc123", "def456")).toBe(true)
    expect(isUpgradeAvailable("abc123", "abc123")).toBe(false)
  })

  it("needs both sides to decide anything", () => {
    expect(isUpgradeAvailable(null, "1.0.0")).toBe(false)
    expect(isUpgradeAvailable("1.0.0", null)).toBe(false)
    expect(isUpgradeAvailable(undefined, undefined)).toBe(false)
  })
})
