import { describe, expect, it } from "vitest"
import type { AccountWorkspace } from "@renderer/types"
import { inAppBlocker, opensInApp } from "./workspace-urls"

describe("inAppBlocker", () => {
  const ws = { id: "w1", slug: "team" }
  const member: AccountWorkspace[] = [
    { workspaceId: "w1", name: "Team", slug: "team", token: null, role: "member", lastActivityAt: null },
  ]

  it("names the reason a workspace opens in the browser, so the card can say it", () => {
    expect(inAppBlocker(ws, undefined, false, member)).toBe("signedOut")
    expect(inAppBlocker({ ...ws, endpoint: "https://ws.example.com" }, undefined, true, member)).toBe("otherDeployment")
    expect(inAppBlocker({ id: "w2", slug: "other" }, undefined, true, member)).toBe("notMember")
    expect(inAppBlocker(ws, undefined, true, null)).toBe("unknown")
    expect(inAppBlocker(ws, undefined, true, member)).toBeNull()
  })
})

describe("opensInApp", () => {
  const ws = { id: "w1", slug: "team" }
  const member: AccountWorkspace[] = [
    { workspaceId: "w1", name: "Team", slug: "team", token: null, role: "owner", lastActivityAt: null },
  ]

  it("opens a workspace the account belongs to, on the configured deployment, in the app", () => {
    expect(opensInApp(ws, undefined, true, member)).toBe(true)
    // The device records the API endpoint; the setting may be empty for the default.
    expect(opensInApp({ ...ws, endpoint: "https://workspace-endpoint.openagents.org/v1" }, "", true, member)).toBe(true)
  })

  it("matches the account's workspace by slug when the ids differ in form", () => {
    expect(opensInApp({ id: "3da3294d", slug: "team" }, undefined, true, member)).toBe(true)
  })

  it("uses the browser for a workspace the account is not a member of", () => {
    // Opening it in the app would add the signed-in account to it as a member.
    expect(opensInApp({ id: "w2", slug: "other" }, undefined, true, member)).toBe(false)
  })

  it("uses the browser while the account's workspaces are unknown", () => {
    expect(opensInApp(ws, undefined, true, null)).toBe(false)
  })

  it("uses the browser while signed out", () => {
    expect(opensInApp(ws, undefined, false, member)).toBe(false)
  })

  it("uses the browser for a workspace on another deployment", () => {
    const elsewhere = { ...ws, endpoint: "https://ws.example.com" }
    expect(opensInApp(elsewhere, undefined, true, member)).toBe(false)
    expect(opensInApp(elsewhere, "https://ws.example.com", true, member)).toBe(true)
  })
})
