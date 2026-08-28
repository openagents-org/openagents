import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

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

describe("listAgentModels — Gemini through a relay", () => {
  // The bug: Test connection passed while the picker said 401. A relay proxies
  // `:generateContent` off the `?key=` query but guards `/v1/models` with
  // `Authorization: Bearer`, so the Google-style list call is the one call that
  // fails — and it failed with the relay's own "invalid token" wording, which
  // reads as a bad key rather than as the wrong header.
  beforeEach(() => {
    httpRequestJson.mockReset()
  })

  it("retries the relay's models endpoint with Bearer after the Google-style 401", async () => {
    httpRequestJson
      .mockResolvedValueOnce({
        status: 401,
        text: JSON.stringify({
          error: { code: "", message: "无效的令牌", type: "new_api_error" },
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: JSON.stringify({ data: [{ id: "gemini-3.5-flash" }] }),
      })
    const r = await listAgentModels("gemini", {
      GEMINI_API_KEY: "sk-relay",
      GOOGLE_GEMINI_BASE_URL: "https://relay.example.com/v1",
    })
    expect(httpRequestJson).toHaveBeenLastCalledWith(
      "https://relay.example.com/v1/models?pageSize=200",
      "GET",
      { Authorization: "Bearer sk-relay" },
      null,
    )
    expect(r.source).toBe("api")
    expect(r.models.map((m) => m.id)).toEqual(["gemini-3.5-flash"])
  })

  it("never sends Bearer to Google itself — it reads one as an OAuth token", async () => {
    httpRequestJson.mockResolvedValueOnce({ status: 401, text: "nope" })
    const r = await listAgentModels("gemini", { GEMINI_API_KEY: "AIza-test" })
    expect(httpRequestJson).toHaveBeenCalledTimes(1)
    expect(r.models).toEqual([])
  })

  it("shows the relay's message, not the whole JSON envelope", async () => {
    httpRequestJson.mockResolvedValue({
      status: 401,
      text: JSON.stringify({
        error: {
          code: "",
          message: "无效的令牌 (request id: 2026081911453639908)",
          type: "new_api_error",
        },
      }),
    })
    const r = await listAgentModels("gemini", {
      GEMINI_API_KEY: "sk-bad",
      GOOGLE_GEMINI_BASE_URL: "https://relay.example.com/v1",
    })
    expect(r.error).toBe("HTTP 401: 无效的令牌 (request id: 2026081911453639908)")
    expect(r.error).not.toContain("new_api_error")
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

describe("listAgentModels — Command Code, via its own CLI", () => {
  // Built from a char code so no invisible control character lands in this
  // source file.
  const ESC = String.fromCharCode(27)
  const BOLD = `${ESC}[1m`
  const DIM = `${ESC}[2m`
  const GREEN = `${ESC}[32m`
  const OFF = `${ESC}[0m`

  /**
   * `command-code --list-models`, colorized as the CLI prints it. Model ids and
   * group headings are BOTH flush-left, which is the thing the parser has to
   * get right.
   */
  const OUT = [
    `${BOLD}Available models${OFF}  ${DIM}·  4 models${OFF}`,
    "",
    `${BOLD}Command Code${OFF}`,
    "",
    `claude-sonnet-4-6      ${DIM}Balanced frontier model${OFF} ${GREEN}(default)${OFF}`,
    `kimi-k2.5              ${GREEN}FREE${OFF} ${DIM}Open weights${OFF}`,
    "",
    `${BOLD}OpenRouter${OFF}`,
    "",
    `moonshotai/kimi-k2.5   ${DIM}Via OpenRouter${OFF}`,
    `Qwen/Qwen3.6-27B       ${DIM}Via OpenRouter${OFF}`,
    "",
    `${DIM}Pass the full id, or just the short name after the last "/":${OFF}`,
    "cmd --model moonshotai/kimi-k2.5",
    "cmd --model kimi-k2.5",
    "",
    `${DIM}Docs:  https://commandcode.ai/docs/reference/cli/models${OFF}`,
  ].join("\n")

  it("asks the CLI, which is the only source spanning plan + BYOK models", async () => {
    const runCli = vi.fn().mockResolvedValue(OUT)
    const r = await listAgentModels("commandcode", {}, { runCli })
    expect(runCli).toHaveBeenCalledWith("commandcode", ["--list-models"], {})
    expect(r.source).toBe("cli")
    expect(r.models.map((m) => m.id)).toEqual([
      "claude-sonnet-4-6",
      "kimi-k2.5",
      "moonshotai/kimi-k2.5",
      // Provider-qualified, so its capitals are not mistaken for a heading.
      "Qwen/Qwen3.6-27B",
    ])
  })

  it("keeps group headings and the usage footer out of the model list", async () => {
    const r = await listAgentModels(
      "commandcode",
      {},
      { runCli: vi.fn().mockResolvedValue(OUT) },
    )
    const ids = r.models.map((m) => m.id)
    // "Command Code" has a space; "OpenRouter" is a bare capitalized word —
    // the case that would otherwise read as a model id.
    expect(ids).not.toContain("OpenRouter")
    expect(ids).not.toContain("Docs:")
    // The footer's example invocations start with the binary name.
    expect(ids.some((id) => id.startsWith("cmd"))).toBe(false)
  })

  it("strips colour, the FREE badge and the (default) marker from the note", async () => {
    const r = await listAgentModels(
      "commandcode",
      {},
      { runCli: vi.fn().mockResolvedValue(OUT) },
    )
    expect(r.models[0].note).toBe("Balanced frontier model")
    expect(r.models[1].note).toBe("Open weights")
    for (const m of r.models) {
      expect(m.id).not.toContain(ESC)
      expect(m.note ?? "").not.toContain(ESC)
    }
  })

  it("says it has no list when the CLI can't be run", async () => {
    const r = await listAgentModels(
      "commandcode",
      {},
      { runCli: vi.fn().mockResolvedValue(null) },
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
