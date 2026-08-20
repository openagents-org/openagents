import { describe, expect, it } from "vitest"

import { isCliLoginDetected, preferredAuthTab } from "./agent-auth"

describe("isCliLoginDetected", () => {
  it("does not label API-key readiness as a CLI login", () => {
    expect(
      isCliLoginDetected(
        { ready: true, auth_mode: "api_key" },
        true,
      ),
    ).toBe(false)
  })

  it("accepts an explicit CLI-login health result", () => {
    expect(
      isCliLoginDetected(
        { ready: true, auth_mode: "cli_login" },
        true,
      ),
    ).toBe(true)
  })

  it("keeps the ready fallback only for legacy login-only agents", () => {
    expect(isCliLoginDetected({ ready: true }, false)).toBe(true)
    expect(isCliLoginDetected({ ready: true }, true)).toBe(false)
  })

  it("prefers an explicit logged_in result", () => {
    expect(
      isCliLoginDetected(
        { ready: true, auth_mode: "api_key", logged_in: true },
        true,
      ),
    ).toBe(true)
  })
})

describe("preferredAuthTab", () => {
  // Claude's real field set: two secrets, plus a base URL and model that carry
  // defaults and must not count as "configured with a key".
  const claudeFields = [
    { name: "ANTHROPIC_API_KEY", password: true },
    { name: "ANTHROPIC_BASE_URL" },
    { name: "ANTHROPIC_MODEL" },
    { name: "CLAUDE_CODE_OAUTH_TOKEN", password: true },
  ]

  it("opens on the key tab once an API key is saved", () => {
    expect(
      preferredAuthTab(claudeFields, {
        ANTHROPIC_API_KEY: "sk-ant-123",
        ANTHROPIC_BASE_URL: "https://yinli.one",
        ANTHROPIC_MODEL: "claude-sonnet-4-6",
      }),
    ).toBe("key")
  })

  it("opens on the key tab for a saved OAuth token too", () => {
    expect(
      preferredAuthTab(claudeFields, { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x" }),
    ).toBe("key")
  })

  it("stays on the CLI tab when only non-secret fields are set", () => {
    // A base URL and model alone mean nothing was authenticated — this is the
    // case that would otherwise send every agent to the key tab, since both
    // fields ship with defaults.
    expect(
      preferredAuthTab(claudeFields, {
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        ANTHROPIC_MODEL: "claude-sonnet-4-6",
      }),
    ).toBe("cli")
  })

  it("treats blank and missing values the same", () => {
    expect(preferredAuthTab(claudeFields, { ANTHROPIC_API_KEY: "   " })).toBe("cli")
    expect(preferredAuthTab(claudeFields, {})).toBe("cli")
    expect(preferredAuthTab(claudeFields, null)).toBe("cli")
    expect(preferredAuthTab([], { ANTHROPIC_API_KEY: "sk-ant-123" })).toBe("cli")
  })
})
