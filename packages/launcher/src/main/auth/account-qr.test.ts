import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AccountManager } from "./account"
import type { AccountSession } from "./session-store"

vi.mock("electron", () => ({ net: {} }))

let stored: AccountSession | null = null
vi.mock("./session-store", async () => {
  const actual = await vi.importActual<typeof import("./session-store")>("./session-store")
  return {
    ...actual,
    loadSession: () => stored,
    saveSession: (s: AccountSession) => { stored = s },
    clearSession: () => { stored = null },
  }
})

/**
 * QR-code sign-in from the desktop app: main starts the request, keeps the
 * poll secret to itself, and keeps the session the approving phone grants.
 */
describe("QR sign-in", () => {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = []
  let pollAnswer: unknown

  beforeEach(() => {
    stored = null
    calls.length = 0
    pollAnswer = { status: "pending" }
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers || {}) as Record<string, string> })
      const data = url.endsWith("/v1/auth/qr")
        ? { id: "req-0123456789abcdef", poll_secret: "secret-xyz", qr_url: "https://workspace.openagents.org/qr-login?id=req-0123456789abcdef", expires_at: new Date(Date.now() + 120_000).toISOString(), poll_interval_ms: 1500 }
        : pollAnswer
      return { ok: true, status: 200, json: async () => ({ code: 0, data }) }
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  const manager = (onChange = vi.fn()) =>
    new AccountManager({ endpoint: () => undefined, openExternal: () => {}, onChange })

  it("starts a desktop request and never hands the poll secret out", async () => {
    const m = manager()
    const start = await m.startQrSignIn()
    expect(start).toMatchObject({ id: "req-0123456789abcdef", pollIntervalMs: 1500 })
    expect(JSON.stringify(start)).not.toContain("secret-xyz")
    expect(calls[0].url).toBe("https://workspace-endpoint.openagents.org/v1/auth/qr")
    expect(calls[0].body).toEqual({ client: "desktop" })
    expect(calls[0].headers["User-Agent"]).toMatch(/^OpenAgentsLauncher \((Macintosh|Windows|Linux)\)$/)
  })

  it("polls with the secret and keeps the approved session", async () => {
    const onChange = vi.fn()
    const m = manager(onChange)
    await m.startQrSignIn()
    expect(await m.pollQrSignIn("req-0123456789abcdef")).toBe("pending")
    expect(calls[1].body).toEqual({ poll_secret: "secret-xyz" })

    pollAnswer = {
      status: "approved",
      session: { session_token: "jwt", email: "wei@example.com", display_name: "Wei", expires_at: "2026-12-12T00:00:00+00:00" },
    }
    expect(await m.pollQrSignIn("req-0123456789abcdef")).toBe("approved")
    expect(stored).toMatchObject({ kind: "workspace", token: "jwt", email: "wei@example.com", displayName: "Wei" })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ email: "wei@example.com" }))
    // The request is finished; polling it again does not reach the server.
    expect(await m.pollQrSignIn("req-0123456789abcdef")).toBe("expired")
    expect(calls).toHaveLength(3)
  })

  it("does not poll a request it did not start, or one replaced by another sign-in", async () => {
    const m = manager()
    expect(await m.pollQrSignIn("someone-elses-request")).toBe("expired")
    await m.startQrSignIn()
    m.cancelSignIn()
    expect(await m.pollQrSignIn("req-0123456789abcdef")).toBe("expired")
    expect(calls).toHaveLength(1)
  })
})
