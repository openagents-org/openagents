/**
 * The fallback identity path: Firebase's REST API, spoken directly.
 *
 * Preferred is always the backend's own POST /v1/auth/session, which returns a
 * 30-day workspace session and needs nothing from Google. That endpoint is 503
 * on a deployment with no WORKSPACE_SESSION_SECRET, and this is what keeps the
 * launcher signing in there: the same one-time custom token, redeemed against
 * Identity Toolkit for an ID token, renewed hourly with its refresh token.
 *
 * Deliberately no Firebase JS SDK: it is a browser library that wants a DOM and
 * per-origin persistence, neither of which the main process has, for two POSTs.
 *
 * Note this path cannot work from mainland China — Google's auth hosts are
 * unreachable there. That is precisely why it is the fallback and not the road.
 */

import { authFetch } from "./http"

/** Public web API key of the `openagentsweb` project (ships in the web bundle). */
const WEB_API_KEY = "AIzaSyCXgN-7HfgAQiN0pRKqGi8jMbGGo9e9X34"

const IDENTITY = "https://identitytoolkit.googleapis.com/v1"
const SECURE_TOKEN = "https://securetoken.googleapis.com/v1"

/** How long a Google call may hang before we call it unreachable. */
const TIMEOUT_MS = 15_000

export interface FirebaseTokens {
  idToken: string
  refreshToken: string
  /** Unix seconds. */
  expiresAt: number
  email: string
  displayName: string | null
}

/** Redeem the login handoff's custom token for an ID token + refresh token. */
export async function signInWithCustomToken(
  customToken: string,
): Promise<FirebaseTokens> {
  return tokensFrom(
    await post(`${IDENTITY}/accounts:signInWithCustomToken`, {
      token: customToken,
      returnSecureToken: true,
    }),
  )
}


function tokensFrom(data: Record<string, unknown>): FirebaseTokens {
  const idToken = String(data.idToken || "")
  const refreshToken = String(data.refreshToken || "")
  if (!idToken || !refreshToken) throw new Error("SIGN_IN_REJECTED")
  const claims = readClaims(idToken)
  return {
    idToken,
    refreshToken,
    expiresAt: expiresAt(data.expiresIn),
    // Accounts created through our own email+password flow carry the address in
    // a custom claim rather than in `email` — read both, as the web app does.
    email: String(claims.email || claims.user_email || ""),
    displayName: (claims.name as string) || null,
  }
}

/** Trade a refresh token for a fresh hour. */
export async function refreshIdToken(
  refreshToken: string,
): Promise<{ idToken: string; refreshToken: string; expiresAt: number }> {
  const data = await post(`${SECURE_TOKEN}/token`, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
  const idToken = String(data.id_token || "")
  if (!idToken) throw new Error("REFRESH_REJECTED")
  return {
    idToken,
    refreshToken: String(data.refresh_token || refreshToken),
    expiresAt: expiresAt(data.expires_in),
  }
}

function expiresAt(seconds: unknown): number {
  return Math.floor(Date.now() / 1000) + (Number(seconds) || 3600)
}

async function post(
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await authFetch(`${url}?key=${WEB_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const json = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!res.ok || !json) {
      const message =
        ((json?.error as { message?: string } | undefined)?.message ||
          `HTTP ${res.status}`)
      throw new Error(message)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

/** The payload of a JWT, without verifying it — the issuer just handed it over. */
function readClaims(jwt: string): Record<string, unknown> {
  try {
    const payload = jwt.split(".")[1]
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"))
  } catch {
    return {}
  }
}
