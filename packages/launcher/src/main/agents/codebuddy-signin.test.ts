import { describe, expect, it } from "vitest"

import {
  CODEBUDDY_SESSION_FILES,
  codebuddyLoginEnv,
  codebuddySessionMatchesRegion,
} from "./codebuddy-signin"

/**
 * The bug this file exists for: the sign-in terminal opened bare, so a user who
 * had picked the China site in the launcher signed in against codebuddy.ai —
 * the terminal said "logged in", and every message the agent then sent failed
 * on auth, because the agent runs with CODEBUDDY_INTERNET_ENVIRONMENT=internal.
 */
describe("codebuddyLoginEnv", () => {
  it("pins the sign-in terminal to the China site", () => {
    // The same value the adapter overlays on the agent's own runs.
    expect(codebuddyLoginEnv({ CODEBUDDY_REGION: "china" })).toEqual({
      CODEBUDDY_INTERNET_ENVIRONMENT: "internal",
    })
  })

  it("pins nothing for the international site", () => {
    // Deliberate: unset is the CLI's documented default AND what lets its
    // startup follow the session on disk. There is no product.external.json to
    // select, so naming a value here would break the international sign-in.
    expect(codebuddyLoginEnv({ CODEBUDDY_REGION: "international" })).toEqual({})
    expect(codebuddyLoginEnv({})).toEqual({})
    expect(codebuddyLoginEnv(undefined)).toEqual({})
  })

  it("falls back to the default for a value it does not know", () => {
    expect(codebuddyLoginEnv({ CODEBUDDY_REGION: "mars" })).toEqual({})
  })

  it("is case- and whitespace-insensitive, like the adapter", () => {
    expect(codebuddyLoginEnv({ CODEBUDDY_REGION: " China " })).toEqual({
      CODEBUDDY_INTERNET_ENVIRONMENT: "internal",
    })
  })
})

describe("codebuddySessionMatchesRegion", () => {
  const cn = { CODEBUDDY_REGION: "china" }

  it("rejects an international session under a China-pinned agent", () => {
    expect(
      codebuddySessionMatchesRegion(
        { auth: { domain: "www.codebuddy.ai" } },
        cn,
      ),
    ).toBe(false)
  })

  it("accepts every China host the CLI signs in from", () => {
    for (const domain of [
      "www.codebuddy.cn",
      "staging.codebuddy.cn",
      "www.workbuddy.cn",
      "staging.workbuddy.cn",
      "copilot.tencent.com",
      "staging-copilot.tencent.com",
    ]) {
      expect(codebuddySessionMatchesRegion({ auth: { domain } }, cn)).toBe(true)
    }
  })

  it("accepts any session when the region pins nothing", () => {
    // international lets the CLI follow the session's own domain, so a China
    // sign-in under an "international" agent works and must not be refused.
    const anywhere = { auth: { domain: "www.codebuddy.cn" } }
    expect(codebuddySessionMatchesRegion(anywhere, {})).toBe(true)
    expect(
      codebuddySessionMatchesRegion(anywhere, {
        CODEBUDDY_REGION: "international",
      }),
    ).toBe(true)
  })

  it("does not refuse a session that records no domain", () => {
    expect(codebuddySessionMatchesRegion({ auth: {} }, cn)).toBe(true)
    expect(codebuddySessionMatchesRegion(null, cn)).toBe(true)
  })
})

describe("session file locations", () => {
  it("covers all three platforms, home-relative", () => {
    expect(CODEBUDDY_SESSION_FILES).toEqual([
      "Library/Application Support/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info",
      "AppData/Local/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info",
      ".local/share/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info",
    ])
  })
})
