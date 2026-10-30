"use strict"

/**
 * Client for the launcher's local control server — the HTTP surface defined in
 * packages/launcher/src/main/control-server.ts.
 *
 * Everything the end-to-end run does to the launcher goes through here: it is
 * the same AgentManager the UI drives over IPC, reached without a display. That
 * matters on the machines this suite runs on daily — a Windows box over SSH has
 * no desktop session, so a GUI driver (Playwright) cannot see the app at all.
 */

const fs = require("fs")
const path = require("path")

const { sleep } = require("./util")

class ControlError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = "ControlError"
    this.status = status
    this.body = body
  }
}

/** Where the running launcher writes its per-start token, under the test HOME. */
function tokenFile(homeDir) {
  return path.join(homeDir, ".openagents", "control.token")
}

/** The token, or null while the app has not written it yet. */
function readToken(homeDir) {
  try {
    const token = fs.readFileSync(tokenFile(homeDir), "utf-8").trim()
    return token || null
  } catch {
    return null
  }
}

/** Current size of the startup log — the baseline a boot reads forward from. */
function startupLogSize(homeDir) {
  try {
    return fs.statSync(startupLog(homeDir)).size
  } catch {
    return 0
  }
}

function startupLog(homeDir) {
  return path.join(homeDir, ".openagents", "startup.log")
}

/**
 * The port the control server chose, from the startup log.
 *
 * We start the app with `--control-port=0` so a run can never collide with
 * another launcher (the user's own, or yesterday's leftover). The app logs the
 * port it landed on, and `fromOffset` is what keeps us from reading YESTERDAY's
 * line: on a reused profile the log already ends with a port that is now dead,
 * and the app writes its token file before it logs the new port — so a naive
 * "last line wins" latches onto the old port and then waits out the whole boot
 * timeout against a closed socket. Pass the log's size from just before the
 * spawn and only this run's lines are considered.
 */
function readControlPort(homeDir, fromOffset = 0) {
  let text
  try {
    const fd = fs.openSync(startupLog(homeDir), "r")
    try {
      const size = fs.fstatSync(fd).size
      if (size <= fromOffset) return null
      const buf = Buffer.alloc(size - fromOffset)
      fs.readSync(fd, buf, 0, buf.length, fromOffset)
      text = buf.toString("utf-8")
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
  const matches = [...text.matchAll(/Control server on 127\.0\.0\.1:(\d+)/g)]
  if (!matches.length) return null
  return Number(matches[matches.length - 1][1])
}

class Control {
  constructor({ port, token, log = () => {} }) {
    this.port = port
    this.token = token
    this.log = log
  }

  async request(method, route, { body, timeoutMs = 30_000 } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await fetch(`http://127.0.0.1:${this.port}${route}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (err) {
      if (err.name === "AbortError") {
        throw new ControlError(
          `${method} ${route} timed out after ${Math.round(timeoutMs / 1000)}s`,
          0,
          null,
        )
      }
      throw new ControlError(
        `${method} ${route} failed: ${err.message}`,
        0,
        null,
      )
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text()
    let parsed = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = { raw: text }
    }
    if (!res.ok) {
      const detail = (parsed && parsed.error) || text.slice(0, 300)
      throw new ControlError(
        `${method} ${route} → ${res.status}: ${detail}`,
        res.status,
        parsed,
      )
    }
    return parsed
  }

  get(route, opts) {
    return this.request("GET", route, opts)
  }

  post(route, body, opts) {
    return this.request("POST", route, { ...opts, body: body || {} })
  }

  // ── Read ────────────────────────────────────────────────────────────────
  status() {
    return this.get("/status", { timeoutMs: 10_000 })
  }

  agents() {
    return this.get("/agents").then((r) => r.agents || [])
  }

  catalog() {
    return this.get("/catalog", { timeoutMs: 60_000 })
  }

  envFields(type) {
    return this.get(`/agents/env-fields?type=${encodeURIComponent(type)}`).then(
      (r) => r.fields || [],
    )
  }

  workspaces() {
    return this.get("/workspaces").then((r) => r.workspaces || [])
  }

  logs(file, tail = 200) {
    return this.get(`/logs?file=${encodeURIComponent(file)}&tail=${tail}`).then(
      (r) => r[file] || "",
    )
  }

  // ── Drive ───────────────────────────────────────────────────────────────
  pair(code) {
    return this.post("/pair", { code }, { timeoutMs: 60_000 })
  }

  startInstall(type) {
    return this.post("/install", { type })
  }

  installStatus(type) {
    return this.get(`/install?type=${encodeURIComponent(type)}`)
  }

  createAgent(name, type, workdir) {
    return this.post("/agents/create", { name, type, path: workdir })
  }

  saveInstanceEnv(name, env) {
    return this.post("/agents/env", { name, env })
  }

  saveTypeEnv(type, env) {
    return this.post("/agents/env", { type, env })
  }

  connect(name, workspace) {
    return this.post(
      "/agents/connect",
      { name, workspace },
      { timeoutMs: 60_000 },
    )
  }

  start(name) {
    return this.post("/agents/start", { name }, { timeoutMs: 60_000 })
  }

  stop(name) {
    return this.post("/agents/stop", { name }, { timeoutMs: 60_000 })
  }

  remove(name) {
    return this.post("/agents/remove", { name }, { timeoutMs: 60_000 })
  }

  sendChat(workspace, channel, agent, content) {
    return this.post(
      "/chat/send",
      { workspace, channel, agent, content },
      { timeoutMs: 60_000 },
    ).then((r) => r.result)
  }

  chatMessages(workspace, channel, limit = 100) {
    const qs = new URLSearchParams({ workspace, limit: String(limit) })
    if (channel) qs.set("channel", channel)
    return this.get(`/chat/messages?${qs}`, { timeoutMs: 60_000 }).then(
      (r) => r.messages || [],
    )
  }

  quit() {
    return this.post("/quit", {}, { timeoutMs: 10_000 }).catch(() => null)
  }

  /**
   * Poll `probe` until it returns a truthy value.
   *
   * Transport errors are swallowed on purpose: a 503 means the core is still
   * loading and a dropped connection means the app is busy — both are states
   * this suite waits through, not failures. `describe` turns the last seen
   * value into the timeout message so a failure says what it was stuck on.
   */
  async waitFor(probe, { timeoutMs, intervalMs = 3_000, label, describe }) {
    const deadline = Date.now() + timeoutMs
    let last = null
    let lastError = null
    while (Date.now() < deadline) {
      try {
        const value = await probe()
        last = value
        if (value) return value
        lastError = null
      } catch (err) {
        lastError = err
      }
      await sleep(intervalMs)
    }
    const detail = lastError
      ? lastError.message
      : describe
        ? describe(last)
        : JSON.stringify(last)
    throw new Error(
      `timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label} (last: ${detail})`,
    )
  }
}

module.exports = {
  Control,
  ControlError,
  readToken,
  readControlPort,
  startupLogSize,
  tokenFile,
}
