import { describe, it, expect } from "vitest"
import type { TFunction } from "i18next"
import { formatHealthLabel } from "./index"
import type { HealthCheck } from "../../types"

// Identity translator: returns the key (or a known label) so assertions read
// against the i18n KEYS the component would render.
const t = ((key: string) => key) as unknown as TFunction

describe("formatHealthLabel — Not installed vs Login required", () => {
  it("shows Not installed ONLY when the executable is genuinely missing", () => {
    const h: HealthCheck = {
      ready: false,
      installed: false,
      reason: "not_installed",
      message: "Not installed",
    }
    expect(formatHealthLabel(h, t)).toBe("agents.list.health.notInstalled")
  })

  it("installed + signed out → Login required, NEVER Not installed", () => {
    const h: HealthCheck = {
      ready: false,
      installed: true,
      reason: "login_required",
      message: "Amp is installed but not signed in — run: amp login or set AMP_API_KEY",
    }
    const label = formatHealthLabel(h, t)
    expect(label).not.toMatch(/not installed/i)
    // prefers the agent-specific message
    expect(label).toMatch(/not signed in/i)
  })

  it("defensively suppresses a stale 'not installed' message on an installed agent", () => {
    const h: HealthCheck = {
      ready: false,
      installed: true,
      reason: "login_required",
      message: "Not installed — run: openagents install amp", // stale wording
    }
    expect(formatHealthLabel(h, t)).toBe("agents.list.health.loginRequired")
  })

  it("ready → Ready (with auth mode)", () => {
    const h: HealthCheck = {
      ready: true,
      installed: true,
      reason: "ready",
      auth_mode: "cli_login",
    }
    const label = formatHealthLabel(h, t)
    expect(label).toContain("agents.list.health.ready")
    expect(label).toContain("agents.list.health.cliLogin")
  })

  it("null health → not configured", () => {
    expect(formatHealthLabel(null, t)).toBe("agents.list.health.notConfigured")
  })
})
