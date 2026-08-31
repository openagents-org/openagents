import { describe, expect, it } from "vitest"

import { orderCoreTiers, unpackedPath, type CoreTier } from "./runtime"

const tier = (
  source: CoreTier["source"],
  version: string | null,
): CoreTier => ({ dir: `/${source}`, version, source })

describe("orderCoreTiers", () => {
  it("runs the app's own core when npm's latest trails it", () => {
    // The exact state that hid Kimi Code CLI: an app built against 0.2.175
    // downloading — and then running — the 0.2.173 that npm still called
    // latest, whose registry describes kimi as an API-only agent.
    const order = orderCoreTiers([
      null,
      tier("global", "0.2.173"),
      tier("bundled", "0.2.175"),
    ])
    expect(order.map((t) => t.source)).toEqual(["bundled", "global"])
  })

  it("still lets a downloaded core newer than the app win", () => {
    const order = orderCoreTiers([
      null,
      tier("global", "0.2.180"),
      tier("bundled", "0.2.175"),
    ])
    expect(order.map((t) => t.source)).toEqual(["global", "bundled"])
  })

  it("keeps the monorepo copy first in dev, whatever the versions say", () => {
    const order = orderCoreTiers([
      tier("local", "0.0.0"),
      tier("global", "9.9.9"),
      tier("bundled", "0.2.175"),
    ])
    expect(order.map((t) => t.source)).toEqual(["local", "global", "bundled"])
  })

  it("prefers the downloaded core on a tie, as it always did", () => {
    const order = orderCoreTiers([
      null,
      tier("global", "0.2.175"),
      tier("bundled", "0.2.175"),
    ])
    expect(order.map((t) => t.source)).toEqual(["global", "bundled"])
  })

  it("sorts an unreadable version below a readable one", () => {
    expect(
      orderCoreTiers([null, tier("global", null), tier("bundled", "0.2.175")]),
    ).toEqual([tier("bundled", "0.2.175"), tier("global", null)])
    // Two unreadable versions are not comparable — discovery order stands.
    expect(
      orderCoreTiers([null, tier("global", null), tier("bundled", null)]).map(
        (t) => t.source,
      ),
    ).toEqual(["global", "bundled"])
  })

  it("drops tiers that are not installed", () => {
    expect(orderCoreTiers([null, null, null])).toEqual([])
    expect(
      orderCoreTiers([null, null, tier("bundled", "0.2.175")]).map(
        (t) => t.source,
      ),
    ).toEqual(["bundled"])
  })

  it("compares a non-semver version by falling back to discovery order", () => {
    const order = orderCoreTiers([
      null,
      tier("global", "nightly"),
      tier("bundled", "0.2.175"),
    ])
    expect(order.map((t) => t.source)).toEqual(["global", "bundled"])
  })
})

describe("unpackedPath", () => {
  it("redirects an asar path to the copy on disk", () => {
    expect(
      unpackedPath("/App/Resources/app.asar/node_modules/x/bin/y.js"),
    ).toBe("/App/Resources/app.asar.unpacked/node_modules/x/bin/y.js")
  })

  it("leaves an already-unpacked or plain path alone", () => {
    const unpacked = "/App/Resources/app.asar.unpacked/node_modules/x/bin/y.js"
    expect(unpackedPath(unpacked)).toBe(unpacked)
    expect(
      unpackedPath("/home/me/repo/packages/agent-connector/bin/y.js"),
    ).toBe("/home/me/repo/packages/agent-connector/bin/y.js")
  })
})
