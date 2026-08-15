import { describe, expect, it } from "vitest"

import { isCliLoginDetected } from "./agent-auth"

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
