import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import {
  configuredControlPort,
  startControlServer,
  tailFile,
  type ControlDeps,
  type ControlServer,
} from "./control-server"

let dir: string
let server: ControlServer | null = null

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-control-"))
})

afterEach(async () => {
  if (server) await server.close()
  server = null
  fs.rmSync(dir, { recursive: true, force: true })
})

function deps(overrides: Partial<ControlDeps> = {}): ControlDeps {
  return {
    getStatus: () => ({ version: "1.2.3", coreReady: true }),
    getAgents: () => [{ name: "oc-win", type: "opencode" }],
    pair: async (code: string) => ({ paired: code }),
    screenshot: async () => null,
    window: () => true,
    logFiles: () => ({}),
    catalog: async () => ({ supported: ["opencode"] }),
    envFields: async () => [{ name: "LLM_API_KEY", required: true }],
    install: async () => ({ ok: true }),
    createAgent: async () => ({ success: true }),
    saveEnv: async () => ({ success: true }),
    connectWorkspace: async () => ({ success: true }),
    startAgent: async () => ({ success: true }),
    stopAgent: async () => ({ success: true }),
    removeAgent: async () => ({ success: true }),
    workspaces: () => [{ id: "ws1", slug: "acme" }],
    sendChat: async () => ({ success: true, messageId: "m1" }),
    chatMessages: async () => [],
    quit: () => {},
    tokenDir: dir,
    ...overrides,
  }
}

async function start(overrides: Partial<ControlDeps> = {}): Promise<ControlServer> {
  server = await startControlServer(0, deps(overrides))
  return server
}

function call(
  srv: ControlServer,
  route: string,
  init: RequestInit = {},
  token = srv.token,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${srv.port}${route}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })
}

describe("startControlServer", () => {
  it("writes the token file with owner-only permissions and removes it on close", async () => {
    const srv = await start()
    expect(fs.readFileSync(srv.tokenFile, "utf-8")).toBe(srv.token)
    if (process.platform !== "win32") {
      expect(fs.statSync(srv.tokenFile).mode & 0o777).toBe(0o600)
    }
    await srv.close()
    server = null
    expect(fs.existsSync(srv.tokenFile)).toBe(false)
  })

  it("rejects requests without the token, with a wrong token, and accepts all three carriers", async () => {
    const srv = await start()
    expect((await call(srv, "/status", {}, "")).status).toBe(401)
    expect((await call(srv, "/status", {}, "nope")).status).toBe(401)
    expect((await call(srv, "/status")).status).toBe(200) // Authorization: Bearer
    const viaHeader = await fetch(`http://127.0.0.1:${srv.port}/status`, {
      headers: { "X-Control-Token": srv.token },
    })
    expect(viaHeader.status).toBe(200)
    const viaQuery = await fetch(
      `http://127.0.0.1:${srv.port}/status?token=${srv.token}`,
    )
    expect(viaQuery.status).toBe(200)
  })

  it("serves status and agents from the injected deps", async () => {
    const srv = await start()
    expect(await (await call(srv, "/status")).json()).toEqual({
      version: "1.2.3",
      coreReady: true,
    })
    expect(await (await call(srv, "/agents")).json()).toEqual({
      agents: [{ name: "oc-win", type: "opencode" }],
    })
  })

  it("POST /pair forwards the code and surfaces handler errors as 500", async () => {
    const srv = await start({
      pair: async (code: string) => {
        if (code === "BAD") throw new Error("PAIRING_CODE_INVALID_FORMAT")
        return { ok: true, code }
      },
    })
    const ok = await call(srv, "/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCD-EFGH" }),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ result: { ok: true, code: "ABCD-EFGH" } })

    const bad = await call(srv, "/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "BAD" }),
    })
    expect(bad.status).toBe(500)
    expect(((await bad.json()) as { error: string }).error).toMatch(
      /PAIRING_CODE_INVALID_FORMAT/,
    )

    const missing = await call(srv, "/pair", { method: "POST", body: "{}" })
    expect(missing.status).toBe(400)
  })

  it("GET /screenshot returns PNG bytes, or 409 when no window exists", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const srv = await start({ screenshot: async () => png })
    const res = await call(srv, "/screenshot")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png)

    await srv.close()
    server = null
    const srv2 = await start({ screenshot: async () => null })
    expect((await call(srv2, "/screenshot")).status).toBe(409)
  })

  it("GET /logs tails the registered files and 404s unknown names", async () => {
    const logFile = path.join(dir, "daemon.log")
    fs.writeFileSync(logFile, ["one", "two", "three", ""].join("\n"))
    const srv = await start({ logFiles: () => ({ daemon: logFile }) })
    const res = await call(srv, "/logs?tail=2")
    expect(await res.json()).toEqual({ daemon: "two\nthree" })

    const missing = await call(srv, "/logs?file=nope")
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { available: string[] }).available).toEqual([
      "daemon",
    ])
  })

  it("POST /window validates the action and reports window presence", async () => {
    const seen: string[] = []
    const srv = await start({
      window: (action) => {
        seen.push(action)
        return action !== "hide"
      },
    })
    const created = await call(srv, "/window", {
      method: "POST",
      body: JSON.stringify({ action: "create" }),
    })
    expect(await created.json()).toEqual({ windowOpen: true })
    const invalid = await call(srv, "/window", {
      method: "POST",
      body: JSON.stringify({ action: "explode" }),
    })
    expect(invalid.status).toBe(400)
    expect(seen).toEqual(["create"])
  })

  it("drives the agent lifecycle through the injected deps", async () => {
    const calls: string[] = []
    const srv = await start({
      createAgent: async (o) => {
        calls.push(`create:${o.name}:${o.type}:${o.path}`)
        return { success: true }
      },
      saveEnv: async (o) => {
        calls.push(`env:${o.name || o.type}:${JSON.stringify(o.env)}`)
        return { success: true }
      },
      connectWorkspace: async (n, w) => {
        calls.push(`connect:${n}:${w}`)
        return { success: true }
      },
      startAgent: async (n) => {
        calls.push(`start:${n}`)
        return { success: true }
      },
      stopAgent: async (n) => {
        calls.push(`stop:${n}`)
        return { success: true }
      },
      removeAgent: async (n) => {
        calls.push(`remove:${n}`)
        return { success: true }
      },
    })
    const post = (route: string, body: unknown): Promise<Response> =>
      call(srv, route, { method: "POST", body: JSON.stringify(body) })

    expect(
      (
        await post("/agents/create", {
          name: "e2e-1",
          type: "opencode",
          path: "/tmp/x",
        })
      ).status,
    ).toBe(200)
    // Non-string env values are dropped rather than coerced.
    await post("/agents/env", { name: "e2e-1", env: { KEY: "sk-1", N: 7 } })
    await post("/agents/connect", { name: "e2e-1", workspace: "acme" })
    await post("/agents/start", { name: "e2e-1" })
    await post("/agents/stop", { name: "e2e-1" })
    await post("/agents/remove", { name: "e2e-1" })

    expect(calls).toEqual([
      "create:e2e-1:opencode:/tmp/x",
      'env:e2e-1:{"KEY":"sk-1"}',
      "connect:e2e-1:acme",
      "start:e2e-1",
      "stop:e2e-1",
      "remove:e2e-1",
    ])

    // Required fields are enforced before any dep runs.
    expect((await post("/agents/create", { name: "only-name" })).status).toBe(
      400,
    )
    expect((await post("/agents/connect", { name: "e2e-1" })).status).toBe(400)
    expect((await post("/agents/start", {})).status).toBe(400)
    expect(calls).toHaveLength(6)
  })

  it("POST /install runs in the background and GET /install reports the outcome", async () => {
    let release: (() => void) | null = null
    const srv = await start({
      install: (type, onData) =>
        new Promise((resolve, reject) => {
          onData(`installing ${type}\n`)
          release = (): void =>
            type === "boom"
              ? reject(new Error("installer exploded"))
              : resolve({})
        }),
    })
    const post = (body: unknown): Promise<Response> =>
      call(srv, "/install", { method: "POST", body: JSON.stringify(body) })

    // Nothing started yet.
    expect(await (await call(srv, "/install?type=opencode")).json()).toEqual({
      type: "opencode",
      state: "idle",
    })

    const started = await post({ type: "opencode" })
    expect(started.status).toBe(202)
    expect((await started.json()) as { state: string }).toMatchObject({
      state: "running",
    })

    // A second POST joins the running job instead of starting a rival installer.
    const again = await post({ type: "opencode" })
    expect(((await again.json()) as { state: string }).state).toBe("running")

    release!()
    await new Promise((r) => setTimeout(r, 20))
    const done = (await (await call(srv, "/install?type=opencode")).json()) as {
      state: string
      log: string
    }
    expect(done.state).toBe("done")
    expect(done.log).toContain("installing opencode")

    expect((await post({})).status).toBe(400)
  })

  it("GET /install surfaces an installer failure as state:error", async () => {
    const srv = await start({
      install: async () => {
        throw new Error("installer exploded")
      },
    })
    await call(srv, "/install", {
      method: "POST",
      body: JSON.stringify({ type: "hermes" }),
    })
    await new Promise((r) => setTimeout(r, 20))
    const job = (await (await call(srv, "/install?type=hermes")).json()) as {
      state: string
      error: string
    }
    expect(job.state).toBe("error")
    expect(job.error).toMatch(/installer exploded/)
  })

  it("serves the workspace + chat surface the respond check needs", async () => {
    let sent: Record<string, unknown> | null = null
    const srv = await start({
      sendChat: async (input) => {
        sent = input as unknown as Record<string, unknown>
        return { success: true, messageId: "m1" }
      },
      chatMessages: async (ws, ch, limit) => [{ ws, ch, limit }],
    })
    expect(await (await call(srv, "/workspaces")).json()).toEqual({
      workspaces: [{ id: "ws1", slug: "acme" }],
    })

    const res = await call(srv, "/chat/send", {
      method: "POST",
      body: JSON.stringify({
        workspace: "ws1",
        channel: "e2e",
        agent: "e2e-1",
        content: "What is 2+2?",
      }),
    })
    expect(res.status).toBe(200)
    expect(sent).toEqual({
      workspaceId: "ws1",
      channelName: "e2e",
      agentId: "e2e-1",
      content: "What is 2+2?",
    })

    expect(
      await (
        await call(srv, "/chat/messages?workspace=ws1&channel=e2e&limit=5")
      ).json(),
    ).toEqual({ messages: [{ ws: "ws1", ch: "e2e", limit: 5 }] })

    expect((await call(srv, "/chat/messages")).status).toBe(400)
    expect(
      (await call(srv, "/chat/send", { method: "POST", body: "{}" })).status,
    ).toBe(400)
  })

  it("answers 503 while the core is still loading, 500 for real failures", async () => {
    const srv = await start({
      workspaces: () => {
        throw new Error("core not loaded yet — retry shortly")
      },
      catalog: async () => {
        throw new Error("registry unreachable")
      },
    })
    expect((await call(srv, "/workspaces")).status).toBe(503)
    expect((await call(srv, "/catalog")).status).toBe(500)
  })

  it("POST /quit answers before the app goes away", async () => {
    let quit = 0
    const srv = await start({ quit: () => quit++ })
    const res = await call(srv, "/quit", { method: "POST" })
    expect(await res.json()).toEqual({ quitting: true })
    expect(quit).toBe(0) // deferred so the response can flush
    await new Promise((r) => setTimeout(r, 80))
    expect(quit).toBe(1)
  })

  it("unknown routes list what exists", async () => {
    const srv = await start()
    const res = await call(srv, "/nope")
    expect(res.status).toBe(404)
    expect(((await res.json()) as { routes: string[] }).routes).toContain(
      "GET /status",
    )
  })
})

describe("configuredControlPort", () => {
  it("prefers --control-port over the env var, and returns null when unset", () => {
    expect(configuredControlPort(["--control-port=4599"], {})).toBe(4599)
    expect(
      configuredControlPort(["--control-port=4599"], {
        OPENAGENTS_CONTROL_PORT: "1111",
      }),
    ).toBe(4599)
    expect(configuredControlPort([], { OPENAGENTS_CONTROL_PORT: "1111" })).toBe(1111)
    expect(configuredControlPort([], {})).toBeNull()
    expect(configuredControlPort(["--control-port=abc"], {})).toBeNull()
    expect(configuredControlPort([], { OPENAGENTS_CONTROL_PORT: "abc" })).toBeNull()
  })
})

describe("tailFile", () => {
  it("returns the last N lines and '' for unreadable files", () => {
    const f = path.join(dir, "t.log")
    fs.writeFileSync(f, "a\nb\nc\n")
    expect(tailFile(f, 2)).toBe("b\nc")
    expect(tailFile(f, 10)).toBe("a\nb\nc")
    expect(tailFile(path.join(dir, "missing.log"), 5)).toBe("")
  })
})
