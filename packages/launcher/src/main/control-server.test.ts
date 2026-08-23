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
