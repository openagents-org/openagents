"use strict"

/**
 * Test doubles for the two services the run talks to: the launcher's control
 * server and the workspace API. Shared by the harness tests — not part of the
 * suite itself (`node --test` only picks up *.test.js).
 */

const http = require("node:http")

function jsonServer(handler) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const send = (code, value) => {
        res.writeHead(code, { "Content-Type": "application/json" })
        res.end(JSON.stringify(value))
      }
      handler({
        route: `${req.method} ${url.pathname}`,
        url,
        input: body ? JSON.parse(body) : {},
        send,
      })
    })
  })
}

/** A control server with just enough behaviour to walk an agent through. */
function stubLauncher({ reply = "The answer is 4.", failStart = false } = {}) {
  const state = {
    agents: [],
    messages: [],
    calls: [],
    env: null,
    installs: new Set(),
    quit: 0,
  }
  const server = jsonServer(({ route, url, input, send }) => {
    state.calls.push(route)
    switch (route) {
      case "GET /status":
        return send(200, { coreReady: true, version: "0.9.23", headless: true })
      case "GET /catalog":
        return send(200, {
          core: { version: "0.2.173" },
          supported: ["openclaw", "codex"],
          catalog: [{ name: "openclaw", installed: false }],
        })
      case "POST /install":
        state.installs.add(input.type)
        return send(202, { type: input.type, state: "running" })
      case "GET /install":
        // Report "running" once, then done — the harness must poll, not assume.
        return send(200, {
          type: url.searchParams.get("type"),
          state: state.installs.has("polled")
            ? "done"
            : (state.installs.add("polled"), "running"),
          durationSeconds: 3,
          log: "installed",
        })
      case "GET /agents/env-fields":
        return send(200, {
          fields: [
            { name: "LLM_API_KEY", required: true },
            { name: "LLM_BASE_URL", required: false },
          ],
        })
      case "POST /agents/create":
        state.agents.push({
          name: input.name,
          type: input.type,
          state: "stopped",
        })
        return send(200, { result: { success: true } })
      case "GET /agents":
        return send(200, { agents: state.agents })
      case "POST /agents/env":
        state.env = input
        return send(200, { result: { success: true } })
      case "POST /agents/connect":
        state.connected = input
        return send(200, { result: { success: true } })
      case "POST /agents/start":
        if (!failStart && state.agents[0]) state.agents[0].state = "running"
        return send(200, { result: { success: true } })
      case "POST /agents/stop":
      case "POST /agents/remove":
        state.agents = []
        return send(200, { result: { success: true } })
      case "POST /pair":
        state.paired = input.code
        return send(200, { result: { paired: true } })
      case "GET /workspaces":
        return send(200, {
          workspaces: [{ id: "w1", slug: "acme", name: "Acme" }],
        })
      case "POST /chat/send":
        state.sent = input
        state.messages.push({
          messageId: `m${state.messages.length}`,
          senderType: "human",
          senderName: "user",
          content: input.content,
        })
        // The agent answers on the next poll, after a thinking placeholder the
        // harness has to skip.
        state.messages.push({
          messageId: "thinking",
          senderType: "agent",
          senderName: input.agent,
          messageType: "thinking",
          content: "Thinking...",
        })
        state.messages.push({
          messageId: "answer",
          senderType: "agent",
          senderName: input.agent,
          content: reply,
        })
        return send(200, { result: { success: true } })
      case "GET /chat/messages":
        return send(200, { messages: state.messages })
      case "GET /logs":
        return send(200, { [url.searchParams.get("file")]: "log" })
      case "POST /quit":
        state.quit++
        return send(200, { quitting: true })
      default:
        return send(404, { error: `no route ${route}` })
    }
  })
  return { server, state }
}

/** The workspace API: enough to look a workspace up and mint a pairing code. */
function stubWorkspaceApi({ workspaceId = "acme" } = {}) {
  const state = { minted: [], removedMembers: [] }
  const server = jsonServer(({ route, send }) => {
    const removal = route.match(
      new RegExp(`^DELETE /v1/workspaces/${workspaceId}/members/(.+)$`),
    )
    if (removal) {
      state.removedMembers.push(decodeURIComponent(removal[1]))
      return send(200, { code: 0, message: "ok", data: { removed: true } })
    }
    if (route === `GET /v1/workspaces/${workspaceId}`) {
      return send(200, {
        code: 0,
        message: "ok",
        data: { id: "w1", slug: workspaceId, name: "Acme" },
      })
    }
    if (route === `POST /v1/workspaces/${workspaceId}/pairing-codes`) {
      const code = `ABCD-${String(1000 + state.minted.length)}`
      state.minted.push(code)
      return send(200, { code: 0, message: "ok", data: { code } })
    }
    return send(404, { code: 404, message: "not found", data: null })
  })
  return { server, state }
}

/** Start a stub and hand back its port plus a close function. */
async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  return { port: server.address().port, close: () => server.close() }
}

module.exports = { stubLauncher, stubWorkspaceApi, listen }
