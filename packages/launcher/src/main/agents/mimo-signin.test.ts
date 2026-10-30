import { describe, expect, it } from "vitest"

import {
  mimoHasXiaomiSignIn,
  mimoRecommendedModel,
  parseMimoModels,
} from "./mimo-signin"

describe("mimoHasXiaomiSignIn", () => {
  it("needs a key under xiaomi", () => {
    expect(
      mimoHasXiaomiSignIn({ xiaomi: { type: "api", key: "sk-x", metadata: { uid: "1" } } }),
    ).toBe(true)
  })

  it("does not count another provider, an empty key, or no store", () => {
    expect(mimoHasXiaomiSignIn({ openai: { type: "api", key: "sk-x" } })).toBe(false)
    expect(mimoHasXiaomiSignIn({ xiaomi: { type: "api", key: " " } })).toBe(false)
    expect(mimoHasXiaomiSignIn({ xiaomi: "sk-x" })).toBe(false)
    expect(mimoHasXiaomiSignIn({})).toBe(false)
    expect(mimoHasXiaomiSignIn(null)).toBe(false)
    expect(mimoHasXiaomiSignIn([])).toBe(false)
  })
})

/** Captured from `mimo models xiaomi` on MiMo Code 0.1.15, signed out. */
const MODELS_OUT = [
  "xiaomi/mimo-v2.5 — window 1.05M, compacts at 944K",
  "xiaomi/mimo-v2.5-pro — window 1.05M, compacts at 944K",
  "xiaomi/mimo-v2.6-flash — window 1.05M, compacts at 944K",
  "xiaomi/mimo-v2.6-pro — window 1.05M, compacts at 944K",
  "",
].join("\n")

describe("parseMimoModels", () => {
  it("reads the qualified ids and keeps the window as a note", () => {
    const models = parseMimoModels(MODELS_OUT)
    expect(models.map((m) => m.id)).toEqual([
      "xiaomi/mimo-v2.5",
      "xiaomi/mimo-v2.5-pro",
      "xiaomi/mimo-v2.6-flash",
      "xiaomi/mimo-v2.6-pro",
    ])
    expect(models[0].note).toBe("window 1.05M, compacts at 944K")
  })

  it("skips other providers and noise", () => {
    expect(
      parseMimoModels("Performing one time database migration...\nmimo/mimo-auto — window 1M\nxiaomi/mimo-v2.5\n"),
    ).toEqual([{ id: "xiaomi/mimo-v2.5" }])
  })
})

describe("mimoRecommendedModel", () => {
  it("names the first plain pro model, else the first listed", () => {
    expect(mimoRecommendedModel(parseMimoModels(MODELS_OUT))).toBe("xiaomi/mimo-v2.5-pro")
    // A Token Plan sign-in, as listed by 0.1.15.
    const tokenPlan = parseMimoModels(
      "xiaomi/mimo-v2.6-flash — window 1.05M\nxiaomi/mimo-v2.6-pro — window 1.05M\nxiaomi/mimo-v2.6-pro-ultraspeed — window 1.05M\n",
    )
    expect(mimoRecommendedModel(tokenPlan)).toBe("xiaomi/mimo-v2.6-pro")
    expect(mimoRecommendedModel([{ id: "xiaomi/mimo-v2.6-flash" }])).toBe("xiaomi/mimo-v2.6-flash")
    expect(mimoRecommendedModel([])).toBeUndefined()
  })
})
