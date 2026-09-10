import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AccountManager } from "./account"
import type { AccountSession } from "./session-store"

// No Electron in a unit test, so authFetch falls through to the global fetch
// the cases below stub. See auth/http.ts.
vi.mock("electron", () => ({ net: {} }))

/**
 * The sign-in as a whole: what URL the browser is sent to, and what the app
 * ends up holding when the page answers.
 *
 * session-store is mocked because the real one writes through Electron's
 * userData path; everything else here is the real thing, loopback server
 * included, with fetch standing in for the browser.
 */

let stored: AccountSession | null = null

vi.mock("./session-store", async () => {
  const actual =
    await vi.importActual<typeof import("./session-store")>("./session-store")
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

const SESSION = {
  token: "session-jwt",
  email: "a@example.com",
  displayName: "A",
  expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400,
}

beforeEach(() => {
  stored = null
})

/**
 * The real fetch, captured before anything stubs it: the stand-in browser below
 * genuinely posts to the loopback server, and must keep doing so while the
 * landing-page probe beside it is answering from a stub.
 */
const realFetch = globalThis.fetch

/**
 * The landing-page probe runs before any browser opens; a present page is the
 * normal case, so it is stubbed once for the whole suite. The case where it is
 * missing has its own test.
 */
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
  )
})

afterEach(() => vi.unstubAllGlobals())

/** Stand in for the browser: read the opened URL, answer the loopback port. */
function browserThatSignsIn(respond: (target: URL) => unknown): {
  opened: string[]
  openExternal: (url: string) => void
} {
  const opened: string[] = []
  return {
    opened,
    openExternal: (url) => {
      opened.push(url)
      const target = new URL(url)
      const port = target.searchParams.get("port")
      const state = target.searchParams.get("state")
      void realFetch(`http://127.0.0.1:${port}/desktop-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, ...(respond(target) as object) }),
      })
    },
  }
}

describe("AccountManager.signIn", () => {
  it("opens the workspace's desktop landing page, not the central login", async () => {
    const browser = browserThatSignsIn(() => ({ session: SESSION }))
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: browser.openExternal,
      onChange: () => {},
    })

    await manager.signIn()

    const opened = new URL(browser.opened[0])
    expect(opened.origin).toBe("https://workspace.openagents.org")
    expect(opened.pathname).toBe("/auth/desktop")
    // A returnTo aimed at /auth/callback is what made the central login skip
    // minting a token at all — the launcher must never build that URL.
    expect(browser.opened[0]).not.toContain("/auth/callback")
    expect(browser.opened[0]).not.toContain("openagents.org/login")
  })

  it("refuses before opening a browser it cannot be answered from", async () => {
    // A deployment without /auth/desktop has no way back into the app; finding
    // that out after the user signed in would waste the whole trip.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    )
    const opened: string[] = []
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: (url) => opened.push(url),
      onChange: () => {},
    })

    await expect(manager.signIn()).rejects.toThrow(
      "SIGN_IN_BROWSER_UNAVAILABLE",
    )
    expect(opened).toHaveLength(0)
  })

  it("keeps the session the page hands back, and reports the account", async () => {
    const seen: Array<unknown> = []
    const browser = browserThatSignsIn(() => ({ session: SESSION }))
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: browser.openExternal,
      onChange: (info) => seen.push(info),
    })

    const account = await manager.signIn()

    expect(account.email).toBe(SESSION.email)
    expect(stored?.kind).toBe("workspace")
    expect(await manager.bearer()).toBe(SESSION.token)
    expect(seen).toHaveLength(1)
  })

  it("surfaces the reason when the page reports one", async () => {
    const browser = browserThatSignsIn(() => ({ error: "SIGN_IN_REJECTED" }))
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: browser.openExternal,
      onChange: () => {},
    })

    await expect(manager.signIn()).rejects.toThrow("SIGN_IN_REJECTED")
    expect(stored).toBeNull()
  })

  it("ends a session that has outlived its thirty days rather than sending it", async () => {
    stored = {
      kind: "workspace",
      token: "stale",
      email: "a@example.com",
      displayName: null,
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    }
    const gone: Array<unknown> = []
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: () => {},
      onChange: (info) => gone.push(info),
    })

    await expect(manager.bearer()).rejects.toThrow("SESSION_EXPIRED")
    expect(stored).toBeNull()
    expect(gone).toEqual([null])
  })
})

/**
 * The in-app sign-in: the account site's own login page runs in the embedded
 * view, and the session it leaves in that page's storage becomes the app's.
 */
describe("AccountManager.adoptSession", () => {
  const SESSION_FROM_PAGE = {
    token: "page-jwt",
    email: "a@example.com",
    displayName: "A",
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400,
  }

  it("takes on what the page established", async () => {
    const seen: Array<unknown> = []
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: () => {},
      onChange: (info) => seen.push(info),
    })

    manager.adoptSession(SESSION_FROM_PAGE)

    expect(manager.getAccount()?.email).toBe("a@example.com")
    expect(stored).toMatchObject({ kind: "workspace", token: "page-jwt" })
    expect(await manager.bearer()).toBe("page-jwt")
    expect(seen).toHaveLength(1)
  })

  it("stays quiet when the page reports the session it already has", () => {
    const seen: Array<unknown> = []
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: () => {},
      onChange: (info) => seen.push(info),
    })

    // The host reads the page on every navigation, so the same session arrives
    // again and again; only a genuinely new one is worth telling the UI about.
    manager.adoptSession(SESSION_FROM_PAGE)
    manager.adoptSession(SESSION_FROM_PAGE)
    manager.adoptSession(SESSION_FROM_PAGE)

    expect(seen).toHaveLength(1)
  })

  it("replaces the session when a different account signs in", () => {
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: () => {},
      onChange: () => {},
    })

    manager.adoptSession(SESSION_FROM_PAGE)
    manager.adoptSession({
      ...SESSION_FROM_PAGE,
      token: "other-jwt",
      email: "b@example.com",
    })

    expect(manager.getAccount()?.email).toBe("b@example.com")
    expect(stored?.token).toBe("other-jwt")
  })
})

/**
 * The in-app password form.
 *
 * The point of these cases is the route: the website keeps its email accounts
 * on the account service, not in Firebase, so a launcher that asks Google
 * about a password the website accepts is told it is wrong. Firebase is only
 * for a deployment with no account service in front of it.
 */
describe("AccountManager.signInWithPassword", () => {
  const ACCOUNT_API = "https://endpoint.openagents.org"

  /** Answer each host with what it really returns; record who was asked. */
  function accountService(
    overrides: Record<
      string,
      { ok?: boolean; status?: number; body?: unknown }
    > = {},
  ): { calls: string[]; fetch: ReturnType<typeof vi.fn> } {
    const calls: string[] = []
    const routes: Record<string, unknown> = {
      "/v1/auth/login": { code: 200, data: { access_token: "account-token" } },
      "/v1/auth/workspace-handoff": { data: { custom_token: "ct-1" } },
      "/v1/auth/session": {
        data: {
          session_token: SESSION.token,
          email: SESSION.email,
          display_name: SESSION.displayName,
          expires_at: new Date(SESSION.expiresAt * 1000).toISOString(),
        },
      },
    }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url)
      const path = Object.keys(routes).find((p) => url.includes(p))
      const override = path ? overrides[path] : undefined
      if (override) {
        return {
          ok: override.ok ?? false,
          status: override.status ?? 500,
          json: async () => override.body ?? {},
          headers: init?.headers,
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => (path ? routes[path] : {}),
      }
    })
    return { calls, fetch: fetchMock as ReturnType<typeof vi.fn> }
  }

  it("signs in through the account service, never through Google", async () => {
    const service = accountService()
    vi.stubGlobal("fetch", service.fetch)
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: () => {},
      onChange: () => {},
    })

    const account = await manager.signInWithPassword("a@example.com", "pw")

    expect(account.email).toBe(SESSION.email)
    expect(stored?.kind).toBe("workspace")
    expect(service.calls[0]).toBe(`${ACCOUNT_API}/v1/auth/login`)
    expect(service.calls[1]).toBe(`${ACCOUNT_API}/v1/auth/workspace-handoff`)
    expect(service.calls[2]).toContain("/v1/auth/session")
    // The whole reason this path exists: it works where Google does not.
    expect(service.calls.some((u) => u.includes("googleapis.com"))).toBe(false)
  })

  it("carries the account token to the handoff as a bearer", async () => {
    const service = accountService()
    vi.stubGlobal("fetch", service.fetch)
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: () => {},
      onChange: () => {},
    })

    await manager.signInWithPassword("a@example.com", "pw")

    const handoff = service.fetch.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("workspace-handoff"),
    )
    expect(
      (handoff?.[1] as RequestInit & { headers: Record<string, string> })
        .headers.Authorization,
    ).toBe("Bearer account-token")
  })

  it("reports a rejected password as such, without asking Google too", async () => {
    const service = accountService({
      "/v1/auth/login": {
        status: 401,
        body: { code: 401, message: "Invalid email or password" },
      },
    })
    vi.stubGlobal("fetch", service.fetch)
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: () => {},
      onChange: () => {},
    })

    await expect(
      manager.signInWithPassword("a@example.com", "wrong"),
    ).rejects.toThrow("SIGN_IN_BAD_CREDENTIALS")
    // Retrying a wrong password against Firebase would spend an attempt there
    // and still fail — the account is not held there.
    expect(service.calls).toHaveLength(1)
    expect(stored).toBeNull()
  })

  it("does not retry against Google when the handoff is what failed", async () => {
    const service = accountService({
      "/v1/auth/workspace-handoff": {
        status: 500,
        body: { message: "handoff unavailable" },
      },
    })
    vi.stubGlobal("fetch", service.fetch)
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: () => {},
      onChange: () => {},
    })

    // The password was accepted; asking Firebase about it now would answer a
    // server fault with "wrong password".
    await expect(
      manager.signInWithPassword("a@example.com", "pw"),
    ).rejects.toThrow("handoff unavailable")
    expect(service.calls.some((u) => u.includes("identitytoolkit"))).toBe(false)
  })

  it("falls back to Firebase only where there is no account service", async () => {
    const service = accountService({
      "/v1/auth/login": { status: 404, body: { message: "Not Found" } },
    })
    vi.stubGlobal("fetch", service.fetch)
    const manager = new AccountManager({
      endpoint: () => undefined,
      openExternal: () => {},
      onChange: () => {},
    })

    // Firebase is stubbed by the same mock and answers nothing usable, so the
    // assertion is that it was reached at all.
    await expect(
      manager.signInWithPassword("a@example.com", "pw"),
    ).rejects.toThrow()
    expect(service.calls.some((u) => u.includes("identitytoolkit"))).toBe(true)
  })
})
