import crypto from "crypto"
import fs from "fs"
import http from "http"
import os from "os"
import path from "path"

/**
 * Local control server — a scriptable test/diagnostics surface for the
 * launcher, reachable with plain curl. Opt-in only: it starts when the app is
 * launched with `--control-port=N` (or OPENAGENTS_CONTROL_PORT=N) and binds
 * 127.0.0.1 exclusively.
 *
 * Motivation: driving the launcher on a remote machine over SSH. There the GUI
 * is unreachable (on Windows, processes started from an SSH session have no
 * desktop), so tests need a way to ask the running app what state it is in
 * (bootstrap, pairing, agents, daemon), trigger the few actions a remote test
 * needs (pair a node, show/hide the window), and pull evidence (screenshots,
 * logs) — without a display, a tunnel, or a Playwright install on either end.
 *
 * Auth: a per-start random token written to ~/.openagents/control.token
 * (0600). Loopback binding keeps other hosts out; the token keeps other local
 * users out. Every request must carry it — Authorization: Bearer, the
 * X-Control-Token header, or ?token= all work.
 *
 * The server is dependency-injected and Electron-free so it can be unit
 * tested; index.ts supplies the real hooks.
 */

export interface ControlDeps {
  /** App/runtime snapshot — everything cheap and synchronous. */
  getStatus: () => Record<string, unknown>
  /** Agent list from the core, [] until the core has loaded. */
  getAgents: () => unknown[]
  /** Redeem a node pairing code (agentManager.connectNode). */
  pair: (code: string) => Promise<unknown>
  /** PNG of the main window, or null when there is no window to capture. */
  screenshot: () => Promise<Buffer | null>
  /** Create/show/hide the main window; returns whether a window now exists. */
  window: (action: "create" | "show" | "hide") => boolean
  /** Absolute paths of log files exposed by GET /logs. */
  logFiles: () => Record<string, string>
  /** Where control.token is written. Defaults to ~/.openagents. */
  tokenDir?: string
}

export interface ControlServer {
  port: number
  token: string
  tokenFile: string
  close: () => Promise<void>
}

/** Last `tail` lines of a file, '' if unreadable. Reads at most ~256 KiB. */
export function tailFile(file: string, tail: number): string {
  try {
    const stat = fs.statSync(file)
    const max = 256 * 1024
    const start = Math.max(0, stat.size - max)
    const fd = fs.openSync(file, "r")
    try {
      const buf = Buffer.alloc(stat.size - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      const lines = buf.toString("utf-8").split(/\r?\n/)
      // Drop a trailing empty element from a final newline, keep blank lines
      // inside the window.
      if (lines.length && lines[lines.length - 1] === "") lines.pop()
      return lines.slice(-tail).join("\n")
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ""
  }
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  })
  res.end(data)
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 64 * 1024) throw new Error("body too large")
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"))
}

function extractToken(req: http.IncomingMessage, url: URL): string {
  const auth = req.headers.authorization || ""
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim()
  const hdr = req.headers["x-control-token"]
  if (typeof hdr === "string" && hdr) return hdr.trim()
  return url.searchParams.get("token") || ""
}

/** Constant-time comparison — a control token must not be guessable byte-by-byte. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function startControlServer(
  port: number,
  deps: ControlDeps,
): Promise<ControlServer> {
  const token = crypto.randomBytes(24).toString("hex")
  const tokenDir = deps.tokenDir || path.join(os.homedir(), ".openagents")
  const tokenFile = path.join(tokenDir, "control.token")
  fs.mkdirSync(tokenDir, { recursive: true })
  fs.writeFileSync(tokenFile, token, { mode: 0o600 })

  const server = http.createServer(async (req, res) => {
    let url: URL
    try {
      url = new URL(req.url || "/", "http://127.0.0.1")
    } catch {
      return json(res, 400, { error: "bad request" })
    }

    if (!tokenMatches(extractToken(req, url), token)) {
      return json(res, 401, { error: "missing or invalid control token" })
    }

    const route = `${req.method} ${url.pathname}`
    try {
      switch (route) {
        case "GET /status":
          return json(res, 200, deps.getStatus())

        case "GET /agents":
          return json(res, 200, { agents: deps.getAgents() })

        case "GET /logs": {
          const tail = Math.min(
            2000,
            Math.max(1, Number(url.searchParams.get("tail")) || 200),
          )
          const which = url.searchParams.get("file")
          const files = deps.logFiles()
          const out: Record<string, string> = {}
          for (const [name, file] of Object.entries(files)) {
            if (which && which !== name) continue
            out[name] = tailFile(file, tail)
          }
          if (which && !(which in files)) {
            return json(res, 404, {
              error: `unknown log '${which}'`,
              available: Object.keys(files),
            })
          }
          return json(res, 200, out)
        }

        case "GET /screenshot": {
          const png = await deps.screenshot()
          if (!png) {
            return json(res, 409, {
              error:
                "no window to capture — POST /window {\"action\":\"create\"} first",
            })
          }
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": png.length,
          })
          return res.end(png)
        }

        case "POST /pair": {
          const body = await readBody(req)
          const code = typeof body.code === "string" ? body.code.trim() : ""
          if (!code) return json(res, 400, { error: "missing 'code'" })
          const result = await deps.pair(code)
          return json(res, 200, { result })
        }

        case "POST /window": {
          const body = await readBody(req)
          const action = body.action
          if (action !== "create" && action !== "show" && action !== "hide") {
            return json(res, 400, {
              error: "action must be 'create', 'show' or 'hide'",
            })
          }
          const windowOpen = deps.window(action)
          return json(res, 200, { windowOpen })
        }

        default:
          return json(res, 404, {
            error: `no route ${route}`,
            routes: [
              "GET /status",
              "GET /agents",
              "GET /logs?file=<name>&tail=N",
              "GET /screenshot",
              "POST /pair {code}",
              "POST /window {action}",
            ],
          })
      }
    } catch (err) {
      return json(res, 500, { error: (err as Error)?.message || String(err) })
    }
  })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      const actual = (server.address() as { port: number }).port
      resolve({
        port: actual,
        token,
        tokenFile,
        close: () =>
          new Promise<void>((r) => {
            // Don't wait for idle keep-alive sockets on shutdown.
            server.closeAllConnections?.()
            server.close(() => {
              try {
                fs.unlinkSync(tokenFile)
              } catch {}
              r()
            })
          }),
      })
    })
  })
}

/**
 * The configured control port: --control-port=N beats OPENAGENTS_CONTROL_PORT.
 * null when neither is set (the default — the server never starts unasked).
 * 0 is valid and means "any free port" (the chosen one is in the token file's
 * sibling status output and the startup log).
 */
export function configuredControlPort(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  for (const arg of argv) {
    const m = /^--control-port=(\d+)$/.exec(arg)
    if (m) return Number(m[1])
  }
  const fromEnv = env.OPENAGENTS_CONTROL_PORT
  if (fromEnv !== undefined && /^\d+$/.test(fromEnv)) return Number(fromEnv)
  return null
}
