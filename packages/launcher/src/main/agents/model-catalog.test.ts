import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// llm-test pulls in electron's `net`, which does not exist under vitest — and
// the HTTP shape is what we want to control here anyway. `vi.hoisted` is what
// lets the mock factory (hoisted above the imports) see this spy.
const { httpRequestJson } = vi.hoisted(() => ({ httpRequestJson: vi.fn() }))
vi.mock("./llm-test", () => ({ httpRequestJson }))

import { listAgentModels } from "./model-catalog"

/** Trimmed to the fields we read, in the shape codex 0.148 writes. */
const CODEX_CACHE = {
  fetched_at: "2026-08-18T03:06:54.783590Z",
  client_version: "0.148.0",
  models: [
    {
      slug: "gpt-5.4",
      display_name: "GPT-5.4",
      visibility: "list",
      priority: 16,
      upgrade: { model: "gpt-5.6-terra" },
    },
    {
      slug: "codex-auto-review",
      display_name: "Codex Auto Review",
      visibility: "hide",
      priority: 43,
    },
    {
      slug: "gpt-5.6-sol",
      display_name: "GPT-5.6-Sol",
      description: "Latest frontier agentic coding model.",
      visibility: "list",
      priority: 1,
    },
  ],
}

let home: string

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"))
  fs.writeFileSync(
    path.join(home, "models_cache.json"),
    JSON.stringify(CODEX_CACHE),
  )
})

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

describe("listAgentModels — codex signed in with ChatGPT (no API key)", () => {
  it("reads the account's own line-up from the CLI's cache", async () => {
    const r = await listAgentModels("codex", { CODEX_HOME: home })
    expect(r.source).toBe("cli")
    // Priority order, internal models dropped.
    expect(r.models.map((m) => m.id)).toEqual(["gpt-5.6-sol", "gpt-5.4"])
    expect(httpRequestJson).not.toHaveBeenCalled()
  })

  it("keeps a model the backend is retiring, but flags it", async () => {
    const r = await listAgentModels("codex", { CODEX_HOME: home })
    const retiring = r.models.find((m) => m.id === "gpt-5.4")
    expect(retiring?.deprecated).toBe(true)
    expect(retiring?.note).toContain("gpt-5.6-terra")
  })

  it("says what to do when there is no cache and no key", async () => {
    const r = await listAgentModels("codex", {
      CODEX_HOME: path.join(home, "nope"),
    })
    expect(r.source).toBe("none")
    expect(r.models).toEqual([])
    expect(r.error).toBeTruthy()
  })
})

describe("listAgentModels — the form's auth path decides the source", () => {
  it("never answers the API-key form from the CLI's signed-in account", async () => {
    // The regression: a machine signed in to Codex with ChatGPT showed that
    // account's models under an API-key form pointed at a relay.
    const r = await listAgentModels(
      "codex",
      { CODEX_HOME: home, OPENAI_BASE_URL: "https://relay.example.com/v1" },
      {},
      "key",
    )
    expect(r.models).toEqual([])
    expect(r.code).toBe("need_key")
    expect(httpRequestJson).not.toHaveBeenCalled()
  })

  it("ignores a key that is present when the sign-in path is the one being set up", async () => {
    const r = await listAgentModels(
      "codex",
      { CODEX_HOME: home, OPENAI_API_KEY: "sk-test" },
      {},
      "login",
    )
    expect(r.source).toBe("cli")
    expect(httpRequestJson).not.toHaveBeenCalled()
  })

  it("does not paper over an endpoint's failure with the CLI's list", async () => {
    httpRequestJson.mockResolvedValueOnce({ status: 401, text: "bad key" })
    const r = await listAgentModels(
      "codex",
      { CODEX_HOME: home, OPENAI_API_KEY: "sk-bad" },
      {},
      "key",
    )
    expect(r.models).toEqual([])
    expect(r.error).toContain("401")
  })

  it("runs cursor's CLI with the key being configured, not the local login", async () => {
    const runCli = vi.fn().mockResolvedValue("auto - Auto (default)")
    await listAgentModels(
      "cursor",
      { CURSOR_API_KEY: "key-from-form" },
      { runCli },
      "key",
    )
    expect(runCli).toHaveBeenCalledWith("cursor", ["--list-models"], {
      CURSOR_API_KEY: "key-from-form",
    })
  })

  it("runs cursor's CLI with no credentials on the sign-in path", async () => {
    const runCli = vi.fn().mockResolvedValue("auto - Auto (default)")
    await listAgentModels(
      "cursor",
      { CURSOR_API_KEY: "key-from-form" },
      { runCli },
      "login",
    )
    expect(runCli).toHaveBeenCalledWith("cursor", ["--list-models"], undefined)
  })
})

describe("listAgentModels — key present", () => {
  it("asks the relay the agent will actually talk to, not api.openai.com", async () => {
    httpRequestJson.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ data: [{ id: "sonnet-relay" }, { id: "gpt-x" }] }),
    })
    const r = await listAgentModels("codex", {
      CODEX_HOME: home,
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://relay.example.com/v1",
    })
    expect(httpRequestJson).toHaveBeenCalledWith(
      "https://relay.example.com/v1/models",
      "GET",
      expect.objectContaining({ Authorization: "Bearer sk-test" }),
      null,
    )
    expect(r.source).toBe("api")
    expect(r.models.map((m) => m.id)).toEqual(["gpt-x", "sonnet-relay"])
  })

  it("falls back to the CLI cache when the endpoint refuses", async () => {
    httpRequestJson.mockResolvedValueOnce({ status: 401, text: "nope" })
    const r = await listAgentModels("codex", {
      CODEX_HOME: home,
      OPENAI_API_KEY: "sk-bad",
    })
    expect(r.source).toBe("cli")
    expect(r.models.length).toBeGreaterThan(0)
  })

  it("sends a relay Bearer and the official endpoint x-api-key (Anthropic)", async () => {
    httpRequestJson.mockResolvedValue({
      status: 200,
      text: JSON.stringify({ data: [{ id: "claude-opus-5" }] }),
    })
    await listAgentModels("claude", { ANTHROPIC_API_KEY: "sk-ant" })
    expect(httpRequestJson).toHaveBeenLastCalledWith(
      "https://api.anthropic.com/v1/models?limit=100",
      "GET",
      expect.objectContaining({ "x-api-key": "sk-ant" }),
      null,
    )
    await listAgentModels("claude", {
      ANTHROPIC_API_KEY: "sk-ant",
      ANTHROPIC_BASE_URL: "https://relay.example.com",
    })
    expect(httpRequestJson).toHaveBeenLastCalledWith(
      "https://relay.example.com/v1/models?limit=100",
      "GET",
      expect.objectContaining({ Authorization: "Bearer sk-ant" }),
      null,
    )
  })
})

describe("listAgentModels — cursor, via its own CLI", () => {
  /** Verbatim `cursor-agent --list-models` output. */
  const OUT = [
    "Available models",
    "",
    "auto - Auto (default)",
    "gpt-5.3-codex - Codex 5.3",
    "composer-2.5 - Composer 2.5 (current)",
  ].join("\n")

  it("asks the CLI, since Cursor has no endpoint to list from", async () => {
    const runCli = vi.fn().mockResolvedValue(OUT)
    const r = await listAgentModels("cursor", {}, { runCli })
    expect(runCli).toHaveBeenCalledWith("cursor", ["--list-models"], {})
    expect(r.source).toBe("cli")
    expect(r.models.map((m) => m.id)).toEqual([
      "auto",
      "gpt-5.3-codex",
      "composer-2.5",
    ])
    // The "(current)" marker is a state, not part of the name.
    expect(r.models[2].label).toBe("Composer 2.5")
  })

  it("says it has no list when the CLI can't be run", async () => {
    const r = await listAgentModels(
      "cursor",
      {},
      {
        runCli: vi.fn().mockResolvedValue(null),
      },
    )
    expect(r.models).toEqual([])
    expect(r.source).toBe("none")
  })
})

describe("listAgentModels — nothing to probe", () => {
  it("offers the built-in Anthropic list for a subscription sign-in", async () => {
    const r = await listAgentModels("claude", {})
    expect(r.source).toBe("builtin")
    expect(r.models.map((m) => m.id)).toContain("claude-opus-5")
  })

  it("returns nothing for an agent with no model setting", async () => {
    const r = await listAgentModels("cursor", {})
    expect(r.source).toBe("none")
    expect(r.models).toEqual([])
  })
})
