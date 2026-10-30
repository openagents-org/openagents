import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { opencodeHasProvider, opencodeRecommendedModel } from "./opencode-signin"

describe("opencodeHasProvider", () => {
  it("needs at least one provider entry", () => {
    expect(opencodeHasProvider({ anthropic: { type: "api", key: "k" } })).toBe(true)
    expect(opencodeHasProvider({})).toBe(false)
    expect(opencodeHasProvider(null)).toBe(false)
  })
})

/**
 * The sign-in path can't run OpenCode without a model, so the picker names one.
 * The order is what the user most plausibly meant: their OpenCode config, then
 * what they last ran, then the newest model of a provider they signed in to.
 */
describe("opencodeRecommendedModel", () => {
  let home: string
  const write = (rel: string, body: string): void => {
    const file = path.join(home, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
  }
  const MODELS = [
    { id: "opencode/big-pickle", released: "2025-10-17" },
    { id: "opencode/north-mini-code-free", released: "2026-05-01" },
    { id: "anthropic/claude-haiku-4-5", released: "2025-10-01" },
    { id: "anthropic/claude-sonnet-5", released: "2026-03-01" },
    { id: "anthropic/claude-old", released: "2026-08-01", deprecated: true },
  ]

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "oa-opencode-"))
  })
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true })
  })

  it("prefers the model set in OpenCode's config (JSONC, last file wins)", () => {
    write(".config/opencode/config.json", '{ "model": "opencode/big-pickle" }')
    write(
      ".config/opencode/opencode.jsonc",
      '{\n  // picked in the TUI — see https://opencode.ai/docs\n  "model": "anthropic/claude-haiku-4-5",\n}',
    )
    write(".local/share/opencode/auth.json", '{ "anthropic": { "type": "api" } }')
    expect(opencodeRecommendedModel(MODELS, home)).toBe("anthropic/claude-haiku-4-5")
  })

  it("falls back to the most recent model OpenCode ran", () => {
    write(".config/opencode/opencode.json", '{ "model": "gone/model" }')
    write(
      ".local/state/opencode/model.json",
      JSON.stringify({
        recent: [
          { providerID: "openai", modelID: "not-listed" },
          { providerID: "opencode", modelID: "big-pickle" },
        ],
      }),
    )
    expect(opencodeRecommendedModel(MODELS, home)).toBe("opencode/big-pickle")
  })

  it("otherwise picks the newest live model of a signed-in provider", () => {
    write(".local/share/opencode/auth.json", '{ "anthropic": { "type": "oauth" } }')
    expect(opencodeRecommendedModel(MODELS, home)).toBe("anthropic/claude-sonnet-5")
  })

  it("signed out, picks the newest model listed at all", () => {
    expect(opencodeRecommendedModel(MODELS, home)).toBe(
      "opencode/north-mini-code-free",
    )
  })

  it("names nothing for an empty list", () => {
    expect(opencodeRecommendedModel([], home)).toBeUndefined()
  })
})
