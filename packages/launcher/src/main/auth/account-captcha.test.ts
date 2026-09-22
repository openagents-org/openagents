import { beforeEach, describe, expect, it, vi } from "vitest"

import { AccountManager } from "./account"
import type { AccountSession } from "./session-store"

// No Electron in a unit test, so authFetch falls through to the global fetch
// the cases below stub. See auth/http.ts.
vi.mock("electron", () => ({ net: {} }))

let stored: AccountSession | null = null
vi.mock("./session-store", async () => {
  const actual = await vi.importActual<typeof import("./session-store")>("./session-store")
  return {
    ...actual,
    loadSession: () => stored,
    saveSession: (s: AccountSession) => {
      stored = s
    },
    clearSession: () => {
      stored = null
    },
  }
})

const ACCOUNT_API = "https://endpoint.openagents.org"
const SESSION = {
  session_token: "session-jwt",
  email: "a@example.com",
  display_name: "A",
  expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
}

/**
 * The account service with the captcha switched on: register/login answer 428
 * unless the body carries a ticket; the config endpoint says so up front.
 */
function service(opts: { enabled?: boolean; configStatus?: number } = {}) {
  const enabled = opts.enabled ?? true
  const bodies: Record<string, unknown> = {}
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (url.includes("/v1/auth/captcha-config")) {
      const status = opts.configStatus ?? 200
      return {
        ok: status === 200,
        status,
        json: async () => ({
          code: 200,
          data: { provider: "tencent", enabled, appId: enabled ? "190000001" : null,
            scriptUrl: "https://ca.turing.captcha.qcloud.com/TJNCaptcha-global.js",
            surfaces: { register: enabled, login: enabled } },
        }),
      }
    }
    if (url.includes("/v1/auth/register") || url.includes("/v1/auth/login")) {
      bodies[url.includes("register") ? "register" : "login"] = body
      if (enabled && !body.captcha_ticket)
        return { ok: false, status: 428, json: async () => ({ code: 428, message: "Human verification is required." }) }
      return { ok: true, status: 200, json: async () => ({ code: 200, data: { access_token: "account-token" } }) }
    }
    if (url.includes("/v1/auth/workspace-handoff"))
      return { ok: true, status: 200, json: async () => ({ data: { custom_token: "ct-1" } }) }
    if (url.includes("/v1/auth/session"))
      return { ok: true, status: 200, json: async () => ({ data: SESSION }) }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  return { calls, bodies, fetch: fetchMock as ReturnType<typeof vi.fn> }
}

function manager(): AccountManager {
  return new AccountManager({ endpoint: () => undefined, openExternal: () => {}, onChange: () => {} })
}

beforeEach(() => {
  stored = null
})

describe("AccountManager captcha", () => {
  it("reads the service's captcha config and caches it", async () => {
    const svc = service()
    vi.stubGlobal("fetch", svc.fetch)
    const m = manager()
    const cfg = await m.captchaConfig()
    expect(cfg).toEqual({
      enabled: true, appId: "190000001",
      scriptUrl: "https://ca.turing.captcha.qcloud.com/TJNCaptcha-global.js",
      surfaces: { register: true, login: true },
    })
    await m.captchaConfig()
    expect(svc.calls.filter((u) => u.includes("captcha-config"))).toHaveLength(1)
    expect(svc.calls[0]).toBe(`${ACCOUNT_API}/v1/auth/captcha-config`)
  })

  it("treats a missing or failing config endpoint as not required", async () => {
    const svc = service({ configStatus: 404 })
    vi.stubGlobal("fetch", svc.fetch)
    expect((await manager().captchaConfig()).enabled).toBe(false)
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net::ERR_FAILED") }))
    expect((await manager().captchaConfig()).enabled).toBe(false)
  })

  it("names the 428 so the form can run the widget and retry", async () => {
    const svc = service()
    vi.stubGlobal("fetch", svc.fetch)
    await expect(manager().signInWithPassword("a@example.com", "pw")).rejects.toThrow("SIGN_IN_CAPTCHA_REQUIRED")
    await expect(manager().signUpWithPassword("b@example.com", "NewAccount1!")).rejects.toThrow("SIGN_IN_CAPTCHA_REQUIRED")
    // never falls through to Firebase on a captcha answer
    expect(svc.calls.some((u) => u.includes("googleapis.com"))).toBe(false)
    expect(stored).toBeNull()
  })

  it("forwards the pass on login and registration exactly as the website does", async () => {
    const svc = service()
    vi.stubGlobal("fetch", svc.fetch)
    const pass = { ticket: "tr03abc", randstr: "@x1y" }
    const account = await manager().signInWithPassword("a@example.com", "pw", pass)
    expect(account.email).toBe("a@example.com")
    expect(svc.bodies.login).toMatchObject({ email: "a@example.com", password: "pw", captcha_ticket: "tr03abc", captcha_randstr: "@x1y" })

    stored = null
    await manager().signUpWithPassword("b@example.com", "NewAccount1!", "B", pass)
    expect(svc.bodies.register).toMatchObject({ email: "b@example.com", display_name: "B", captcha_ticket: "tr03abc", captcha_randstr: "@x1y" })
  })

  it("sends no captcha fields when the service does not ask for them", async () => {
    const svc = service({ enabled: false })
    vi.stubGlobal("fetch", svc.fetch)
    await manager().signInWithPassword("a@example.com", "pw")
    expect(svc.bodies.login).toEqual({ email: "a@example.com", password: "pw" })
  })
})
