import { describe, it, expect } from "vitest"

import { clineCredentialUsable, CLINE_PROVIDERS_FILE } from "./cline-signin"

describe("clineCredentialUsable", () => {
  it("accepts a provider with a stored key", () => {
    const creds = {
      lastUsedProvider: "openrouter",
      providers: { openrouter: { settings: { apiKey: "sk-live" } } },
    }
    expect(clineCredentialUsable(creds, {})).toBe(true)
  })

  it("accepts a credential stored under any of the token field names", () => {
    for (const field of ["apikey", "token", "accessToken", "access_token", "refreshToken", "sessionToken"]) {
      const creds = {
        lastUsedProvider: "anthropic",
        providers: { anthropic: { settings: { [field]: "value" } } },
      }
      expect(clineCredentialUsable(creds, {}), field).toBe(true)
    }
  })

  it("rejects a selected key-based provider with nothing stored", () => {
    // The one shape that is provably unusable: the user picked a provider that
    // authenticates with a key, and no provider holds one.
    const creds = {
      lastUsedProvider: "openrouter",
      providers: { openrouter: { settings: { model: "anthropic/claude-sonnet-4.6" } } },
    }
    expect(clineCredentialUsable(creds, {})).toBe(false)
  })

  it("accepts Cline's own account provider with no key on disk", () => {
    // The account session lives outside providers.json, so a missing apiKey
    // here is not evidence of being signed out. Reporting "Login required" at
    // these users would be wrong.
    const creds = {
      lastUsedProvider: "cline",
      providers: { cline: { settings: { model: "claude-sonnet-5" } } },
    }
    expect(clineCredentialUsable(creds, {})).toBe(true)
  })

  it("accepts an env key even when the file holds nothing usable", () => {
    const creds = {
      lastUsedProvider: "openrouter",
      providers: { openrouter: { settings: {} } },
    }
    expect(clineCredentialUsable(creds, { CLINE_API_KEY: "sk-live" })).toBe(true)
    expect(clineCredentialUsable(creds, { OPENROUTER_API_KEY: "sk-live" })).toBe(true)
    expect(clineCredentialUsable(creds, { CLINE_API_KEY: "   " })).toBe(false)
  })

  it("defers when there is no selected provider", () => {
    expect(clineCredentialUsable({ providers: { openai: { settings: {} } } }, {})).toBe(true)
  })

  it("defers when the selected provider is not in the file at all", () => {
    const creds = { lastUsedProvider: "mystery", providers: { openai: { settings: {} } } }
    expect(clineCredentialUsable(creds, {})).toBe(true)
  })

  it("defers on a shape it does not recognise rather than claiming signed out", () => {
    // A future Cline version can reshape its own settings file; guessing "no
    // credentials" there would break sign-in detection for working setups.
    expect(clineCredentialUsable(null, {})).toBe(true)
    expect(clineCredentialUsable("nonsense", {})).toBe(true)
    expect(clineCredentialUsable([], {})).toBe(true)
    expect(clineCredentialUsable({ providers: [] }, {})).toBe(true)
    expect(clineCredentialUsable({}, {})).toBe(true)
  })

  it("points at the path the CLI actually writes", () => {
    // Matches the file the core adapter reads (cline.js `_readProvidersConfig`).
    expect(CLINE_PROVIDERS_FILE).toBe(".cline/data/settings/providers.json")
  })
})
