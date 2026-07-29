import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"

import {
  MCP_TARGETS,
  applyMcpServer,
  removeMcpServer,
  listMcpTargets,
  type McpTarget,
} from "./mcp-config"

const SECRET = "lin_api_test_key"

let dir: string
let targets: McpTarget[]

/** Same entry shapes as the real targets, but pointed at a scratch dir. */
function scratchTargets(root: string): McpTarget[] {
  return MCP_TARGETS.map((t) => ({
    ...t,
    file: path.join(root, t.id, path.basename(t.file)),
  }))
}

const fileFor = (id: string): string => targets.find((t) => t.id === id)!.file
const readFile = (id: string): Record<string, any> =>
  JSON.parse(fs.readFileSync(fileFor(id), "utf-8"))

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-mcp-"))
  targets = scratchTargets(dir)
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("applyMcpServer", () => {
  it("writes each client's own entry shape for the same endpoint", () => {
    const res = applyMcpServer("linear", SECRET, ["claude", "cursor", "gemini"], targets)
    expect(res).toMatchObject({ ok: true, errors: [] })
    expect(res.written.sort()).toEqual(["claude", "cursor", "gemini"])

    // Claude Code needs an explicit transport tag.
    expect(readFile("claude").mcpServers.linear).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    // Cursor infers the transport from `url`.
    expect(readFile("cursor").mcpServers.linear).toEqual({
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    // For the Gemini CLI, `url` would mean SSE — streamable HTTP is `httpUrl`.
    expect(readFile("gemini").mcpServers.linear).toEqual({
      httpUrl: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${SECRET}` },
    })
  })

  it("preserves unrelated keys and other servers, and backs the file up once", () => {
    const file = fileFor("claude")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({
        numStartups: 42,
        projects: { "/tmp/x": { allowedTools: [] } },
        mcpServers: { other: { type: "http", url: "https://example.com/mcp" } },
      }),
    )

    applyMcpServer("linear", SECRET, ["claude"], targets)

    const after = readFile("claude")
    expect(after.numStartups).toBe(42)
    expect(after.projects).toEqual({ "/tmp/x": { allowedTools: [] } })
    expect(after.mcpServers.other).toEqual({ type: "http", url: "https://example.com/mcp" })
    expect(after.mcpServers.linear.url).toBe("https://mcp.linear.app/mcp")

    // The backup captures the pre-modification state...
    const backup = `${file}.openagents.bak`
    expect(JSON.parse(fs.readFileSync(backup, "utf-8")).mcpServers.linear).toBeUndefined()

    // ...and a second write must not overwrite that original snapshot.
    applyMcpServer("linear", "second_key", ["claude"], targets)
    expect(JSON.parse(fs.readFileSync(backup, "utf-8")).mcpServers.linear).toBeUndefined()
    expect(readFile("claude").mcpServers.linear.headers.Authorization).toBe("Bearer second_key")
  })

  it("refuses to clobber a config it cannot parse", () => {
    const file = fileFor("claude")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "{ not json ")

    const res = applyMcpServer("linear", SECRET, ["claude"], targets)
    expect(res.ok).toBe(false)
    expect(res.written).toEqual([])
    expect(res.errors[0]).toContain("Claude Code")
    // Original bytes untouched.
    expect(fs.readFileSync(file, "utf-8")).toBe("{ not json ")
  })

  it("rejects platforms with no known MCP endpoint", () => {
    const res = applyMcpServer("telegram", SECRET, ["claude"], targets)
    expect(res.ok).toBe(false)
    expect(res.errors[0]).toContain("telegram")
    expect(fs.existsSync(fileFor("claude"))).toBe(false)
  })
})

describe("removeMcpServer", () => {
  it("drops only this platform's entry", () => {
    const file = fileFor("cursor")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { url: "https://x/mcp" } } }))
    applyMcpServer("linear", SECRET, ["cursor"], targets)

    const res = removeMcpServer("linear", ["cursor"], targets)
    expect(res).toMatchObject({ ok: true, written: ["cursor"] })
    expect(readFile("cursor").mcpServers).toEqual({ other: { url: "https://x/mcp" } })
  })

  it("is a no-op when the file or entry is absent", () => {
    expect(removeMcpServer("linear", ["claude"], targets)).toMatchObject({
      ok: true,
      written: [],
    })
  })
})

describe("listMcpTargets", () => {
  it("reports detection, configured state, and parse errors", () => {
    applyMcpServer("linear", SECRET, ["claude"], targets)
    const bad = fileFor("gemini")
    fs.mkdirSync(path.dirname(bad), { recursive: true })
    fs.writeFileSync(bad, "nope")

    const byId = Object.fromEntries(
      listMcpTargets("linear", targets).map((s) => [s.id, s]),
    )
    expect(byId.claude).toMatchObject({ detected: true, configured: true })
    expect(byId.cursor).toMatchObject({ detected: false, configured: false })
    expect(byId.gemini.error).toBeTruthy()
    expect(byId.gemini.configured).toBe(false)
  })

  it("reports nothing as configured for a platform with no MCP endpoint", () => {
    applyMcpServer("linear", SECRET, ["claude"], targets)
    expect(listMcpTargets("telegram", targets).every((s) => !s.configured)).toBe(true)
  })
})
