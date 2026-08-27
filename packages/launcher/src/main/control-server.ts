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

  // ── Driving surface ────────────────────────────────────────────────────
  // What tests/end_to_end/run.js needs to walk an agent from "nothing
  // installed" to "answered a message", through the same AgentManager calls
  // the renderer reaches over IPC. Each throws while the core is still
  // loading; the server answers 503 for that so a script can just retry.

  /** Core info + supported types + installed types (GET /catalog). */
  catalog: () => Promise<unknown>
  /** The fields the Configure dialog would show (GET /agents/env-fields). */
  envFields: (type: string) => Promise<unknown[]>
  /** Install an agent type, streaming installer output to `onData` (POST /install). */
  install: (type: string, onData: (chunk: string) => void) => Promise<unknown>
  /** Register an agent instance (POST /agents/create). */
  createAgent: (opts: {
    name: string
    type: string
    path?: string
  }) => Promise<unknown>
  /** Save env for one instance (`name`) or a whole type (`type`) (POST /agents/env). */
  saveEnv: (opts: {
    name?: string
    type?: string
    env: Record<string, string>
  }) => Promise<unknown>
  /** Bind an agent to a paired workspace (POST /agents/connect). */
  connectWorkspace: (name: string, workspace: string) => Promise<unknown>
  /** Ask the daemon to start one agent (POST /agents/start). */
  startAgent: (name: string) => Promise<unknown>
  /** Ask the daemon to stop one agent (POST /agents/stop). */
  stopAgent: (name: string) => Promise<unknown>
  /** Delete an agent instance (POST /agents/remove). */
  removeAgent: (name: string) => Promise<unknown>
  /** Workspaces registered on this device (GET /workspaces). */
  workspaces: () => unknown[]
  /** Post a chat message as the user (POST /chat/send). */
  sendChat: (input: {
    workspaceId: string
    channelName?: string
    agentId?: string
    content: string
  }) => Promise<unknown>
  /** Recent messages in a channel (GET /chat/messages). */
  chatMessages: (
    workspaceId: string,
    channelName: string | undefined,
    limit: number,
  ) => Promise<unknown[]>
  /** Quit the app — teardown for a test run (POST /quit). */
  quit: () => void

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

/** A trimmed string field from a JSON body, '' when absent or the wrong type. */
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/** A string map from a JSON body — non-string values are dropped, not coerced. */
function envRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== "object") return out
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val
  }
  return out
}

/**
 * An agent install runs for minutes and streams as it goes, so POST /install
 * starts it and returns immediately; GET /install?type= reports how it went.
 * One job per type (installs are per-type and idempotent), kept in memory for
 * the life of the app — a test that loses its connection can poll again.
 */
interface InstallJob {
  type: string
  state: "running" | "done" | "error"
  startedAt: number
  endedAt: number | null
  log: string
  error: string | null
}

/** Installer output is unbounded; keep the tail, which is where failures are. */
const INSTALL_LOG_MAX = 64 * 1024

function appendLog(job: InstallJob, chunk: string): void {
  job.log = (job.log + chunk).slice(-INSTALL_LOG_MAX)
}

function jobView(job: InstallJob): Record<string, unknown> {
  return {
    type: job.type,
    state: job.state,
    startedAt: new Date(job.startedAt).toISOString(),
    endedAt: job.endedAt ? new Date(job.endedAt).toISOString() : null,
    durationSeconds: Math.round(
      ((job.endedAt || Date.now()) - job.startedAt) / 1000,
    ),
    error: job.error,
    log: job.log,
  }
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

  const installs = new Map<string, InstallJob>()

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

        case "GET /catalog":
          return json(res, 200, await deps.catalog())

        case "GET /agents/env-fields": {
          const type = url.searchParams.get("type") || ""
          if (!type) return json(res, 400, { error: "missing 'type'" })
          return json(res, 200, { type, fields: await deps.envFields(type) })
        }

        case "POST /install": {
          const body = await readBody(req)
          const type = str(body.type)
          if (!type) return json(res, 400, { error: "missing 'type'" })
          const running = installs.get(type)
          // Already installing — hand back the job instead of starting a
          // second installer over the top of the first.
          if (running && running.state === "running") {
            return json(res, 202, jobView(running))
          }
          const job: InstallJob = {
            type,
            state: "running",
            startedAt: Date.now(),
            endedAt: null,
            log: "",
            error: null,
          }
          installs.set(type, job)
          deps
            .install(type, (chunk) => appendLog(job, chunk))
            .then(() => {
              job.state = "done"
              job.endedAt = Date.now()
            })
            .catch((err: unknown) => {
              job.state = "error"
              job.endedAt = Date.now()
              job.error = (err as Error)?.message || String(err)
            })
          return json(res, 202, jobView(job))
        }

        case "GET /install": {
          const type = url.searchParams.get("type") || ""
          if (!type) return json(res, 400, { error: "missing 'type'" })
          const job = installs.get(type)
          if (!job) return json(res, 200, { type, state: "idle" })
          return json(res, 200, jobView(job))
        }

        case "POST /agents/create": {
          const body = await readBody(req)
          const name = str(body.name)
          const type = str(body.type)
          if (!name || !type)
            return json(res, 400, { error: "missing 'name' or 'type'" })
          const result = await deps.createAgent({
            name,
            type,
            path: str(body.path) || undefined,
          })
          return json(res, 200, { result })
        }

        case "POST /agents/env": {
          const body = await readBody(req)
          const name = str(body.name)
          const type = str(body.type)
          if (!name && !type)
            return json(res, 400, { error: "missing 'name' or 'type'" })
          const result = await deps.saveEnv({
            name: name || undefined,
            type: type || undefined,
            env: envRecord(body.env),
          })
          return json(res, 200, { result })
        }

        case "POST /agents/connect": {
          const body = await readBody(req)
          const name = str(body.name)
          const workspace = str(body.workspace)
          if (!name || !workspace)
            return json(res, 400, { error: "missing 'name' or 'workspace'" })
          const result = await deps.connectWorkspace(name, workspace)
          return json(res, 200, { result })
        }

        case "POST /agents/start":
        case "POST /agents/stop":
        case "POST /agents/remove": {
          const body = await readBody(req)
          const name = str(body.name)
          if (!name) return json(res, 400, { error: "missing 'name'" })
          const action = url.pathname.split("/").pop()
          const result =
            action === "start"
              ? await deps.startAgent(name)
              : action === "stop"
                ? await deps.stopAgent(name)
                : await deps.removeAgent(name)
          return json(res, 200, { result })
        }

        case "GET /workspaces":
          return json(res, 200, { workspaces: deps.workspaces() })

        case "POST /chat/send": {
          const body = await readBody(req)
          const workspaceId = str(body.workspace) || str(body.workspaceId)
          const content = typeof body.content === "string" ? body.content : ""
          if (!workspaceId || !content)
            return json(res, 400, { error: "missing 'workspace' or 'content'" })
          const result = await deps.sendChat({
            workspaceId,
            channelName: str(body.channel) || undefined,
            agentId: str(body.agent) || undefined,
            content,
          })
          return json(res, 200, { result })
        }

        case "GET /chat/messages": {
          const workspaceId = url.searchParams.get("workspace") || ""
          if (!workspaceId)
            return json(res, 400, { error: "missing 'workspace'" })
          const limit = Math.min(
            500,
            Math.max(1, Number(url.searchParams.get("limit")) || 100),
          )
          const messages = await deps.chatMessages(
            workspaceId,
            url.searchParams.get("channel") || undefined,
            limit,
          )
          return json(res, 200, { messages })
        }

        case "POST /quit": {
          // Answer before quitting: app.quit() tears down this server, so a
          // reply written afterwards would never reach the caller.
          json(res, 200, { quitting: true })
          setTimeout(() => deps.quit(), 50)
          return
        }

        default:
          return json(res, 404, {
            error: `no route ${route}`,
            routes: [
              "GET /status",
              "GET /agents",
              "GET /logs?file=<name>&tail=N",
              "GET /screenshot",
              "GET /catalog",
              "GET /agents/env-fields?type=<type>",
              "GET /install?type=<type>",
              "GET /workspaces",
              "GET /chat/messages?workspace=<id>&channel=<name>&limit=N",
              "POST /pair {code}",
              "POST /window {action}",
              "POST /install {type}",
              "POST /agents/create {name, type, path?}",
              "POST /agents/env {name|type, env}",
              "POST /agents/connect {name, workspace}",
              "POST /agents/start {name}",
              "POST /agents/stop {name}",
              "POST /agents/remove {name}",
              "POST /chat/send {workspace, content, channel?, agent?}",
              "POST /quit",
            ],
          })
      }
    } catch (err) {
      const message = (err as Error)?.message || String(err)
      // The core loads asynchronously after the app starts, so every driving
      // route is unavailable for the first minutes of a cold boot. That is a
      // "try again shortly", not a server fault — say so with the status code
      // rather than making callers pattern-match on the message.
      const code = /^core not loaded/i.test(message) ? 503 : 500
      return json(res, code, { error: message })
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
