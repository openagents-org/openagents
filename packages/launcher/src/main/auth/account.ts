import { apiBase, webBase } from "./endpoints"
import { authFetch } from "./http"
import { refreshIdToken, signInWithCustomToken } from "./firebase-rest"
import { startHandoffServer, type Handoff } from "./handoff-server"
import {
  clearSession,
  isFresh,
  loadSession,
  saveSession,
  toAccountInfo,
  type AccountInfo,
  type AccountSession,
} from "./session-store"

/**
 * The signed-in user, as the main process holds them.
 *
 * Account identity lives here rather than in the renderer because two different
 * origins need it: the launcher's own UI (a file:// page) and the embedded
 * workspace view (https://workspace.openagents.org). Browser auth state is
 * per-origin and cannot be shared between them — only main can feed both.
 *
 * Signing in is a workspace-scoped gate, never an app-scoped one: everything
 * under My Agents works signed out, and nothing here is touched until the user
 * asks for something that is theirs (their workspaces, authorizing this
 * machine). See docs on the lazy gate in the desktop-workspace plan.
 */

/** One membership from GET /v1/account/workspaces. */
export interface AccountWorkspace {
  workspaceId: string
  name: string
  slug: string
  /** Shared workspace access token; null for a viewer or a tokenless workspace. */
  token: string | null
  role: "owner" | "admin" | "member" | "viewer"
  lastActivityAt: string | null
}

export interface AccountDeps {
  /** The configured workspace endpoint, if the user set one. */
  endpoint: () => string | undefined
  /** Hand a URL to the OS browser (web-security's openExternalSafely). */
  openExternal: (url: string) => void
  /** Told whenever the account appears, changes or goes away. */
  onChange: (account: AccountInfo | null) => void
}

/** Google's auth hosts are unreachable in China; that failure must read plainly. */
const FIREBASE_UNREACHABLE = "SIGN_IN_UNREACHABLE"

/**
 * The browser round trip needs a page on the workspace site to come back
 * through. A deployment that predates it would land the user on a bare 404
 * saying "workspace not found", which explains nothing and looks like their
 * account is broken.
 */
const BROWSER_UNAVAILABLE = "SIGN_IN_BROWSER_UNAVAILABLE"

export class AccountManager {
  private _session: AccountSession | null = null
  private _loaded = false
  private _pending: Handoff | null = null

  constructor(private _deps: AccountDeps) {}

  /** The account, or null. Reads the stored session on first use. */
  getAccount(): AccountInfo | null {
    this._ensureLoaded()
    return this._session ? toAccountInfo(this._session) : null
  }

  private _ensureLoaded(): void {
    if (this._loaded) return
    this._loaded = true
    this._session = loadSession()
  }

  private _set(session: AccountSession | null): void {
    this._session = session
    this._loaded = true
    if (session) saveSession(session)
    else clearSession()
    this._deps.onChange(session ? toAccountInfo(session) : null)
  }

  /**
   * Run a sign-in: open the central login in the user's browser and wait for
   * the callback page to hand the session back over loopback.
   *
   * The system browser, not an in-app window: Google refuses OAuth in an
   * embedded webview ("this browser is not secure"), and the user's existing
   * session there is usually what makes this one click.
   */
  async signIn(): Promise<AccountInfo> {
    // A second click while one is in flight replaces it — the first browser tab
    // is already stale, and leaving its port open would be a second live gate.
    this.cancelSignIn()

    const origin = webBase(this._deps.endpoint())
    // Checked before a port is opened and a browser is launched: without the
    // landing page there is no way back into the app, and finding that out
    // after the user has signed in wastes the whole trip.
    if (!(await landingPageExists(origin))) throw new Error(BROWSER_UNAVAILABLE)

    const handoff = await startHandoffServer(origin)
    this._pending = handoff

    // Straight to the workspace's own desktop landing page, NOT to the central
    // login: that login treats `returnTo` as where to go after minting its
    // one-time token and bouncing through /auth/callback, so a returnTo aimed
    // at the callback is taken as the destination and no token is minted at
    // all. /auth/desktop is an ordinary page, so it can send the user through
    // the login itself — and when the browser is already signed in to the
    // workspace, it skips that entirely and answers on the spot.
    this._deps.openExternal(
      `${origin}/auth/desktop?port=${handoff.port}&state=${encodeURIComponent(handoff.state)}`,
    )

    try {
      const result = await handoff.result
      if (result.error) throw new Error(result.error)

      if (result.session?.token && result.session.email) {
        this._set({
          kind: "workspace",
          token: result.session.token,
          email: result.session.email,
          displayName: result.session.displayName ?? null,
          expiresAt: result.session.expiresAt,
        })
      } else if (result.customToken) {
        this._set(await this._redeem(result.customToken))
      } else {
        throw new Error("SIGN_IN_EMPTY_HANDOFF")
      }
      return toAccountInfo(this._session!)
    } finally {
      handoff.close()
      if (this._pending === handoff) this._pending = null
    }
  }

  /**
   * The session as the embedded workspace view needs it — token included.
   *
   * Synchronous because the view's preload has to plant it before the page's
   * first script runs; callers that can afford to await should call `bearer()`
   * first so what is planted is freshly renewed.
   */
  embeddedSession(): {
    token: string
    email: string
    displayName: string | null
    expiresAt: number
  } | null {
    this._ensureLoaded()
    if (!this._session) return null
    const { token, email, displayName, expiresAt } = this._session
    return { token, email, displayName, expiresAt }
  }

  /**
   * Adopt the session the embedded workspace page has just established.
   *
   * The in-app sign-in reuses the account site's own login page, so the
   * session appears in that page's storage rather than being handed to us —
   * the host reads it out and calls this. Idempotent: the page reports on
   * every navigation, and only a genuinely new token is worth a broadcast.
   */
  adoptSession(
    session: {
      token: string
      email: string
      displayName?: string | null
      expiresAt: number
    } | null,
  ): void {
    this._ensureLoaded()
    if (!session) {
      // The page signed out. Drop the account here too, but leave the view
      // alone — it is already showing its own signed-out state, and tearing it
      // down would be answering a report with an action.
      if (this._session) this._set(null)
      return
    }
    if (this._session?.token === session.token) return
    this._set({
      kind: "workspace",
      token: session.token,
      email: session.email,
      displayName: session.displayName ?? null,
      expiresAt: session.expiresAt,
    })
  }

  /** Give the loopback port back without waiting for the browser. */
  cancelSignIn(): void {
    this._pending?.close()
    this._pending = null
  }

  signOut(): void {
    this.cancelSignIn()
    this._set(null)
  }

  /**
   * Turn the one-time custom token into a session we can keep.
   *
   * Only reached when the callback page forwarded the token unspent — an older
   * deployment of the workspace front end, or a backend with no session secret.
   */
  private async _redeem(customToken: string): Promise<AccountSession> {
    try {
      return await this._mintWorkspaceSession(customToken)
    } catch (err) {
      // The session endpoint is the one that works everywhere; Firebase is the
      // consolation prize, and where it is blocked there is nothing left to try.
      console.error(
        "workspace session unavailable, falling back to Firebase:",
        (err as Error).message,
      )
    }
    try {
      const tokens = await signInWithCustomToken(customToken)
      return {
        kind: "firebase",
        token: tokens.idToken,
        refreshToken: tokens.refreshToken,
        email: tokens.email,
        displayName: tokens.displayName,
        expiresAt: tokens.expiresAt,
      }
    } catch (err) {
      const message = (err as Error).message
      throw new Error(
        /abort|fetch failed|network/i.test(message)
          ? FIREBASE_UNREACHABLE
          : message,
      )
    }
  }

  private async _mintWorkspaceSession(
    customToken: string,
  ): Promise<AccountSession> {
    const res = await authFetch(`${apiBase(this._deps.endpoint())}/v1/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_token: customToken }),
    })
    const json = (await res.json().catch(() => null)) as {
      data?: SessionPayload
      message?: string
    } | null
    if (!res.ok || !json?.data?.session_token)
      throw new Error(json?.message || `HTTP ${res.status}`)
    return sessionFrom(json.data)
  }

  /**
   * The bearer to send, renewed if it is about to lapse.
   *
   * A workspace session cannot be renewed — it is minted from a one-time token
   * and lasts 30 days — so an expired one ends the session outright and the UI
   * asks for a sign-in. A Firebase ID token renews itself hourly.
   */
  async bearer(): Promise<string> {
    this._ensureLoaded()
    const session = this._session
    if (!session) throw new Error("NOT_SIGNED_IN")
    if (isFresh(session)) return session.token

    if (session.kind !== "firebase" || !session.refreshToken) {
      this._set(null)
      throw new Error("SESSION_EXPIRED")
    }
    try {
      const renewed = await refreshIdToken(session.refreshToken)
      this._set({ ...session, ...renewed, token: renewed.idToken })
      return renewed.idToken
    } catch {
      this._set(null)
      throw new Error("SESSION_EXPIRED")
    }
  }

  /**
   * The user's workspaces. The endpoint also reconciles legacy access and
   * gives a brand-new account an empty workspace to own, so a signed-in user
   * always has at least one.
   */
  async listWorkspaces(): Promise<AccountWorkspace[]> {
    return this._get<AccountWorkspace[]>("/v1/account/workspaces")
  }

  /**
   * Mint a pairing code for this device, as the signed-in user.
   *
   * This is the whole of "authorize this machine": the backend gains nothing
   * new — the same owner/admin-only endpoint the workspace UI calls — the
   * launcher just carries the code across instead of the user retyping it.
   * A member (below admin) is refused here, which is correct and is why the
   * manual code entry stays.
   */
  async createPairingCode(workspaceId: string): Promise<string> {
    const data = await this._request<{ code: string }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/pairing-codes`,
      { method: "POST", body: "{}" },
    )
    if (!data.code) throw new Error("PAIRING_CODE_MISSING")
    return data.code
  }

  private _get<T>(path: string): Promise<T> {
    return this._request<T>(path, { method: "GET" })
  }

  private async _request<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.bearer()
    const res = await authFetch(`${apiBase(this._deps.endpoint())}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
    const json = (await res.json().catch(() => null)) as {
      data?: T
      message?: string
    } | null
    if (res.status === 401) {
      // The server has the last word on whether we are still someone: drop the
      // session rather than leave the UI showing an account that cannot act.
      this._set(null)
      throw new Error("SESSION_EXPIRED")
    }
    if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`)
    return json?.data as T
  }
}

/** What both session endpoints return. */
interface SessionPayload {
  session_token?: string
  expires_at?: string
  email?: string
  display_name?: string | null
}

function sessionFrom(data: SessionPayload): AccountSession {
  return {
    kind: "workspace",
    token: data.session_token!,
    email: data.email || "",
    displayName: data.display_name ?? null,
    expiresAt: Math.floor(new Date(data.expires_at || 0).getTime() / 1000),
  }
}

/**
 * Whether this deployment serves /auth/desktop — the page a browser sign-in
 * returns through. Any answer other than "not there" counts as present: a
 * network blip must not be reported as a missing feature.
 */
async function landingPageExists(webOrigin: string): Promise<boolean> {
  try {
    const res = await authFetch(`${webOrigin}/auth/desktop`, { method: "GET" })
    return res.status !== 404
  } catch {
    return true
  }
}
