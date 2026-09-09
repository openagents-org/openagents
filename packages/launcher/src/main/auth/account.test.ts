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
  const actual = await vi.importActual<typeof import("./session-store")>(
    "./session-store",
  )
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
function browserThatSignsIn(
  respond: (target: URL) => unknown,
): { opened: string[]; openExternal: (url: string) => void } {
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

    await expect(manager.signIn()).rejects.toThrow("SIGN_IN_BROWSER_UNAVAILABLE")
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
    manager.adoptSession({ ...SESSION_FROM_PAGE, token: "other-jwt", email: "b@example.com" })

    expect(manager.getAccount()?.email).toBe("b@example.com")
    expect(stored?.token).toBe("other-jwt")
  })
})
