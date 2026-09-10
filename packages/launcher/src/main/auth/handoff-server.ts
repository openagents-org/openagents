import crypto from "crypto"
import http from "http"
import type { AddressInfo } from "net"

/**
 * The loopback half of the desktop sign-in.
 *
 * Electron has no http origin an OAuth provider will redirect to, so the sign-in
 * runs in the user's own browser and hands its result back here:
 *
 *   1. this server binds 127.0.0.1 on a random port and invents a `state`
 *   2. the browser opens openagents.org/login with a returnTo that carries
 *      `desktop=<port>.<state>` through to workspace.openagents.org/auth/callback
 *   3. that page exchanges the one-time custom token for a session and POSTs it
 *      to http://127.0.0.1:<port>/desktop-auth
 *   4. the state is checked, the promise resolves, the server closes
 *
 * The window is deliberately small: a random port, a single-use state, one
 * accepted request, and a hard timeout. The token does cross a cleartext local
 * socket — unavoidable for a loopback handoff — so nothing here outlives the
 * one exchange it exists for.
 */

/** How long a sign-in may stay open before the port is given back. */
const TIMEOUT_MS = 5 * 60 * 1000

/** A browser POST big enough for a JWT and nothing more. */
const MAX_BODY_BYTES = 16 * 1024

/** What the callback page hands back. */
export interface HandoffResult {
  /** A workspace session JWT — the path we ask for. */
  session?: {
    token: string
    email: string
    displayName?: string | null
    expiresAt: number
  }
  /**
   * The raw openagents.org custom token, forwarded unconsumed when the backend
   * could not mint a session (no WORKSPACE_SESSION_SECRET configured). The
   * caller redeems it against Firebase instead.
   */
  customToken?: string
  /** Present when the browser side failed and wants to say why. */
  error?: string
}

export interface Handoff {
  port: number
  state: string
  /** Resolves on the first valid callback; rejects on timeout or cancel. */
  result: Promise<HandoffResult>
  /** Idempotent — safe to call after the promise settled. */
  close: () => void
}

/**
 * Start the loopback listener. `webOrigin` is the only origin allowed to talk
 * to it, which is what keeps any other page in the browser from reading the
 * port's replies.
 */
export async function startHandoffServer(
  webOrigin: string,
): Promise<Handoff> {
  const state = crypto.randomBytes(24).toString("base64url")
  let settle: ((r: HandoffResult) => void) | null = null
  let fail: ((e: Error) => void) | null = null
  const result = new Promise<HandoffResult>((resolve, reject) => {
    settle = resolve
    fail = reject
  })

  const server = http.createServer((req, res) => {
    // Same-origin rules apply to the browser's fetch, not to us: the callback
    // page can only read our reply if we name it here.
    res.setHeader("Access-Control-Allow-Origin", webOrigin)
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    // Chrome's Private Network Access check: a public https page reaching a
    // loopback address must be granted it explicitly, or the preflight is
    // blocked and the POST never arrives. Without this the sign-in falls all
    // the way back to a navigation, which works but dumps the user on a bare
    // 127.0.0.1 page instead of leaving them on ours.
    res.setHeader("Access-Control-Allow-Private-Network", "true")
    // Nothing here is ever worth keeping.
    res.setHeader("Cache-Control", "no-store")

    if (req.method === "OPTIONS") {
      res.writeHead(204).end()
      return
    }
    if (!req.url?.startsWith("/desktop-auth")) {
      res.writeHead(404).end()
      return
    }

    readBody(req)
      .then((body) => {
        const payload = parsePayload(req.url || "", body)
        if (!payload || payload.state !== state) {
          // A wrong state is either a stale tab or something else on this
          // machine probing the port. Say nothing useful either way.
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: false }))
          return
        }
        respondOk(req, res)
        settle?.({
          session: payload.session,
          customToken: payload.customToken,
          error: payload.error,
        })
        // One handoff per server: close as soon as the reply is on the wire.
        setImmediate(close)
      })
      .catch(() => {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false }))
      })
  })

  const timer = setTimeout(() => {
    fail?.(new Error("SIGN_IN_TIMED_OUT"))
    close()
  }, TIMEOUT_MS)
  // The app must still be able to quit while a sign-in is pending.
  timer.unref?.()

  let closed = false
  function close(): void {
    if (closed) return
    closed = true
    clearTimeout(timer)
    server.close()
  }
  // A rejection nobody is listening for yet would be an unhandled rejection.
  result.catch(() => {})

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })

  const port = (server.address() as AddressInfo).port
  return { port, state, result, close }
}

/**
 * Answer the handoff.
 *
 * A POST is answered in JSON, for the page that made it. A navigation — the
 * fallback path — gets a page instead, because the user is looking at it: the
 * browser has left the workspace site and would otherwise be staring at a line
 * of JSON on a numeric address.
 */
function respondOk(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method === "POST" || !req.headers.accept?.includes("text/html")) {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(SIGNED_IN_PAGE)
}

/**
 * Deliberately wordless about which app it is and in one neutral style: this
 * page is only ever seen for a second, it cannot know the launcher's language
 * or theme, and it must not look like something to interact with.
 */
const SIGNED_IN_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signed in</title>
<style>
  :root { color-scheme: light dark }
  body { margin: 0; height: 100vh; display: flex; align-items: center;
         justify-content: center; font: 15px/1.5 system-ui, sans-serif }
  p { opacity: .65 }
</style></head>
<body><p>Signed in. You can close this tab and return to the app.</p></body></html>`

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE")
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString("utf-8")
}

interface Payload extends HandoffResult {
  state?: string
}

/**
 * Read the handoff out of a POST body, falling back to the query string.
 *
 * The query form exists because a browser that refuses the cross-origin POST
 * (an extension, a corporate policy) can still navigate to the URL, and a
 * sign-in that lands is worth more than one that is tidy.
 */
function parsePayload(url: string, body: string): Payload | null {
  if (body) {
    try {
      const raw = JSON.parse(body) as Payload & { ct?: string }
      // `ct` on the wire, `customToken` in here: the browser side names it the
      // way the login URL does, this side names it what it is.
      return { ...raw, customToken: raw.ct ?? raw.customToken }
    } catch {
      return null
    }
  }
  const query = new URL(url, "http://127.0.0.1").searchParams
  const state = query.get("state")
  if (!state) return null
  const token = query.get("session_token")
  return {
    state,
    ...(token
      ? {
          session: {
            token,
            email: query.get("email") || "",
            displayName: query.get("display_name"),
            expiresAt: Number(query.get("expires_at")) || 0,
          },
        }
      : {}),
    ...(query.get("ct") ? { customToken: query.get("ct")! } : {}),
    ...(query.get("error") ? { error: query.get("error")! } : {}),
  }
}
