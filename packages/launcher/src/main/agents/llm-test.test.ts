import { EventEmitter } from "events"
import fs from "node:fs"
import path from "node:path"
import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * A scripted `net.request`: each call takes the next behaviour off the queue.
 * "silent" is a socket that accepts the request and then never answers — the
 * shape a stalled relay actually takes, and the only way to reach the timeout.
 */
type Behavior =
  | { kind: "ok"; status: number; body: string }
  | { kind: "error"; message: string }
  | { kind: "silent" }

let script: Behavior[] = []
let calls: Array<{
  url: string
  method: string
  headers: Record<string, string>
  body: string
}> = []

function makeFakeRequest(opts: { url: string; method: string }): EventEmitter {
  const call = {
    url: opts.url,
    method: opts.method,
    headers: {} as Record<string, string>,
    body: "",
  }
  calls.push(call)
  const req = new EventEmitter() as EventEmitter & {
    setHeader: (k: string, v: string) => void
    write: (b: string) => void
    abort: () => void
    end: () => void
  }
  req.setHeader = (k: string, v: string) => {
    call.headers[k.toLowerCase()] = v
  }
  req.write = (b: string) => {
    call.body = b
  }
  req.abort = () => {}
  req.end = () => {
    const next = script.shift() || { kind: "silent" as const }
    if (next.kind === "silent") return
    setTimeout(() => {
      if (next.kind === "error") {
        req.emit("error", new Error(next.message))
        return
      }
      const res = new EventEmitter() as EventEmitter & { statusCode: number }
      res.statusCode = next.status
      req.emit("response", res)
      setTimeout(() => {
        res.emit("data", Buffer.from(next.body, "utf-8"))
        res.emit("end")
      }, 0)
    }, 0)
  }
  return req
}

vi.mock("electron", () => ({
  net: {
    request: (opts: { url: string; method: string }) => makeFakeRequest(opts),
  },
}))

import { launcherAuthFields } from "./auth-specs"
import {
  httpRequestJson,
  httpRequestOnce,
  testLLMConnection,
} from "./llm-test"

/** A minimal OpenAI chat-completions answer. */
const CHAT_OK = (model = "m") =>
  JSON.stringify({
    model,
    choices: [{ message: { content: "Hi there, how are you?" } }],
  })
/** A minimal Anthropic messages answer. */
const MSG_OK = (model = "m") =>
  JSON.stringify({ model, content: [{ text: "Hi there, how are you?" }] })
const ok = (body: string) => ({ kind: "ok" as const, status: 200, body })

beforeEach(() => {
  script = []
  calls = []
})

describe("httpRequestJson", () => {
  it("retries once when nothing answered", async () => {
    script = [
      { kind: "error", message: "net::ERR_CONNECTION_RESET" },
      { kind: "ok", status: 200, body: '{"ok":true}' },
    ]
    const r = await httpRequestJson(
      "https://relay.example.com/v1/models",
      "GET",
      {},
      null,
    )
    expect(r.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it("does not retry what the endpoint actually answered", async () => {
    // A 401 is the endpoint's verdict on the key. Asking twice wastes the
    // user's time and tells them nothing new.
    script = [{ kind: "ok", status: 401, body: "invalid key" }]
    const r = await httpRequestJson(
      "https://relay.example.com/v1/models",
      "GET",
      {},
      null,
    )
    expect(r.status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it("gives up after the retry rather than looping", async () => {
    script = [
      { kind: "error", message: "socket hang up" },
      { kind: "error", message: "socket hang up" },
    ]
    await expect(
      httpRequestJson("https://relay.example.com/v1/models", "GET", {}, null),
    ).rejects.toThrow(/socket hang up/)
    expect(calls).toHaveLength(2)
  })

  it("does not retry a URL that was never valid", async () => {
    await expect(httpRequestJson("not-a-url", "GET", {}, null)).rejects.toThrow(
      /Invalid URL/,
    )
    expect(calls).toHaveLength(0)
  })
})

describe("httpRequestOnce timeouts", () => {
  beforeEach(() => vi.useFakeTimers())

  it("waits longer on a POST than on a GET", async () => {
    // A GET lists models; a POST is a real completion a cold relay can sit on.
    script = [{ kind: "silent" }, { kind: "silent" }]

    const get = httpRequestOnce(
      "https://relay.example.com/v1/models",
      "GET",
      {},
      null,
    )
    const post = httpRequestOnce(
      "https://relay.example.com/v1/chat/completions",
      "POST",
      {},
      "{}",
    )
    const settled = { get: false, post: false }
    get.catch(() => (settled.get = true))
    post.catch(() => (settled.post = true))

    await vi.advanceTimersByTimeAsync(20_000)
    expect(settled).toEqual({ get: true, post: false })

    await vi.advanceTimersByTimeAsync(25_000)
    expect(settled).toEqual({ get: true, post: true })

    vi.useRealTimers()
  })
})

/**
 * Every agent that authenticates with an API key + base URL has to reach the
 * endpoint the AGENT will call — a vendor API, a relay, or a model gateway.
 *
 * The regressions these cover are all the same shape: a key variable that
 * matched no branch fell through to the generic OpenAI path and came back as
 * "No API key to test for this agent", with the key plainly in the form.
 */
describe("testLLMConnection routing", () => {
  it("probes OpenWorker's provider endpoint instead of reporting no key", async () => {
    script = [ok(CHAT_OK("deepseek-chat"))]
    const r = await testLLMConnection({
      OPENWORKER_PROVIDER: "deepseek",
      OPENWORKER_API_KEY: "sk-ow",
      OPENWORKER_MODEL: "deepseek-chat",
    })
    expect(r.success).toBe(true)
    expect(calls[0].url).toBe("https://api.deepseek.com/v1/chat/completions")
    expect(calls[0].headers.authorization).toBe("Bearer sk-ow")
  })

  it("sends OpenWorker at its base URL when one is configured", async () => {
    script = [ok(CHAT_OK())]
    await testLLMConnection({
      OPENWORKER_PROVIDER: "deepseek",
      OPENWORKER_API_KEY: "sk-ow",
      OPENWORKER_BASE_URL: "https://relay.example.com/v1",
      OPENWORKER_MODEL: "glm-5",
    })
    // The relay's own /v1 is not doubled — …/v1/v1/chat/completions is a 404
    // that reads like a dead endpoint.
    expect(calls[0].url).toBe(
      "https://relay.example.com/v1/chat/completions",
    )
  })

  it("asks a keyless local OpenWorker provider without an auth header", async () => {
    script = [ok(CHAT_OK())]
    const r = await testLLMConnection({
      OPENWORKER_PROVIDER: "ollama",
      OPENWORKER_MODEL: "llama3",
    })
    expect(r.success).toBe(true)
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions")
    expect(calls[0].headers.authorization).toBeUndefined()
  })

  it("probes Goose at its configured host", async () => {
    script = [ok(CHAT_OK())]
    const r = await testLLMConnection({
      GOOSE_PROVIDER: "openai",
      GOOSE_PROVIDER__API_KEY: "sk-goose",
      GOOSE_PROVIDER__HOST: "https://gw.example.com/v1",
      GOOSE_MODEL: "glm-5",
    })
    expect(r.success).toBe(true)
    expect(calls[0].url).toBe("https://gw.example.com/v1/chat/completions")
  })

  it("names the missing endpoint for a Goose provider it cannot reach", async () => {
    const r = await testLLMConnection({
      GOOSE_PROVIDER: "bedrock",
      GOOSE_PROVIDER__API_KEY: "sk-goose",
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/GOOSE_PROVIDER__HOST/)
    expect(r.error).not.toMatch(/No API key/i)
  })

  it("tells CodeBuddy users how their key is verified", async () => {
    const r = await testLLMConnection({
      CODEBUDDY_API_KEY: "sk-demo-abc",
      CODEBUDDY_MODEL: "deepseek-v4-pro",
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/CodeBuddy/)
    // The bug this replaces: a filled-in key reported as no key at all.
    expect(r.error).not.toMatch(/No API key/i)
    // And the trap behind that report — a gateway key has nowhere to go here.
    expect(r.error).toMatch(/CODEBUDDY_BASE_URL/)
    expect(calls).toHaveLength(0)
  })

  it("reads DEEPSEEK_API_BASE as the endpoint to probe", async () => {
    script = [ok(CHAT_OK())]
    await testLLMConnection({
      DEEPSEEK_API_KEY: "sk-ds",
      DEEPSEEK_API_BASE: "https://relay.example.com/v1",
      DEEPSEEK_MODEL: "deepseek-chat",
    })
    expect(calls[0].url).toBe("https://relay.example.com/v1/chat/completions")
  })

  it("probes Aider's endpoint once its provider is named", async () => {
    script = [ok(CHAT_OK())]
    const r = await testLLMConnection({
      AIDER_PROVIDER: "openai-compatible",
      LLM_API_KEY: "sk-aider",
      LLM_BASE_URL: "https://relay.example.com/v1",
      AIDER_MODEL: "openai/glm-5",
    })
    expect(r.success).toBe(true)
    // The LiteLLM provider prefix is stripped: the endpoint wants the bare id.
    expect(JSON.parse(calls[0].body).model).toBe("glm-5")
  })

  it("sends a relay both Anthropic auth headers", async () => {
    script = [ok(MSG_OK())]
    await testLLMConnection({
      ANTHROPIC_API_KEY: "sk-ant",
      ANTHROPIC_BASE_URL: "https://relay.example.com",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
    })
    // Which header a proxy honours is not knowable from here, and sending only
    // the wrong one is a 401 that reads as a bad key.
    expect(calls[0].headers["x-api-key"]).toBe("sk-ant")
    expect(calls[0].headers.authorization).toBe("Bearer sk-ant")
  })

  it("uses only x-api-key against Anthropic itself", async () => {
    script = [ok(MSG_OK())]
    await testLLMConnection({ ANTHROPIC_API_KEY: "sk-ant" })
    expect(calls[0].headers["x-api-key"]).toBe("sk-ant")
    expect(calls[0].headers.authorization).toBeUndefined()
  })
})

describe("testLLMConnection model handling", () => {
  it("asks the endpoint what it serves when no model is configured", async () => {
    script = [
      ok(JSON.stringify({ data: [{ id: "glm-5" }, { id: "kimi-k2.6" }] })),
      ok(CHAT_OK("glm-5")),
    ]
    const r = await testLLMConnection({
      OPENAI_API_KEY: "sk-gw",
      OPENAI_BASE_URL: "https://api-gateway.example.org/v1",
    })
    expect(r.success).toBe(true)
    expect(calls[0]).toMatchObject({
      url: "https://api-gateway.example.org/v1/models",
      method: "GET",
    })
    // Not the hardcoded gpt-4o-mini, which no gateway serves.
    expect(JSON.parse(calls[1].body).model).toBe("glm-5")
  })

  it("falls back to the vendor default when an endpoint lists nothing", async () => {
    script = [{ kind: "ok", status: 404, body: "nope" }, ok(CHAT_OK())]
    await testLLMConnection({
      OPENAI_API_KEY: "sk-gw",
      OPENAI_BASE_URL: "https://gw.example.com/v1",
    })
    expect(JSON.parse(calls[1].body).model).toBe("gpt-4o-mini")
  })

  it("does not ask a vendor's own API for a list", async () => {
    // OpenAI's catalogue is long, arbitrarily ordered, and mixed with models
    // that cannot answer a completion — its known-good default is better.
    script = [ok(CHAT_OK())]
    await testLLMConnection({ OPENAI_API_KEY: "sk-openai" })
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].body).model).toBe("gpt-4o-mini")
  })

  it("skips catalogue entries that cannot answer a completion", async () => {
    script = [
      ok(
        JSON.stringify({
          data: [
            { id: "text-embedding-3-small" },
            { id: "whisper-1" },
            { id: "glm-5" },
          ],
        }),
      ),
      ok(CHAT_OK("glm-5")),
    ]
    await testLLMConnection({
      LLM_API_KEY: "sk-gw",
      LLM_BASE_URL: "https://gw.example.com/v1",
    })
    expect(JSON.parse(calls[1].body).model).toBe("glm-5")
  })

  it("does not ask for a list when the model is already chosen", async () => {
    script = [ok(CHAT_OK("glm-5"))]
    await testLLMConnection({
      LLM_API_KEY: "sk-gw",
      LLM_BASE_URL: "https://api-gateway.example.org/v1",
      LLM_MODEL: "glm-5",
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe("POST")
  })

  it("explains a rejected model instead of echoing raw JSON", async () => {
    script = [
      {
        kind: "ok",
        status: 400,
        body: JSON.stringify({
          detail:
            "Model 'gpt-4o-mini' is not available. This gateway only allows: glm-5, kimi-k2.6",
        }),
      },
    ]
    const r = await testLLMConnection({
      LLM_API_KEY: "sk-gw",
      LLM_BASE_URL: "https://api-gateway.example.org/v1",
      LLM_MODEL: "gpt-4o-mini",
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/doesn't serve 'gpt-4o-mini'/)
    expect(r.error).toMatch(/glm-5/)
  })
})

/**
 * The drift guard.
 *
 * Every bug this file's routing tests describe had the same cause: an agent
 * was given a credential field in the registry (or in the launcher's own auth
 * overrides) and nobody taught the connection test that the field exists. The
 * agent then fell through every branch to the generic OpenAI path, which
 * answered "No API key to test for this agent" — about a form with a key in it.
 *
 * So rather than listing the agents we happen to have fixed, walk the SAME
 * sources the Configure dialog builds its form from, fill every credential
 * field, and assert the test never claims there is no key. A new agent with a
 * new `*_API_KEY` fails here on the day it is added.
 */
describe("no agent with credential fields reports a missing key", () => {
  const registryDir = path.resolve(process.cwd(), "../../registry")
  const entries = fs
    .readdirSync(registryDir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => ({
      type: f.replace(/\.json$/, ""),
      def: JSON.parse(fs.readFileSync(path.join(registryDir, f), "utf-8")),
    }))

  const isCredential = (name: string) => /_API_KEY$|_KEY$|_TOKEN$/.test(name)

  /** The fields the launcher actually renders: its override, else the registry. */
  const formFields = (type: string, def: Record<string, unknown>) =>
    (launcherAuthFields(type) ||
      (def.env_config as Array<Record<string, unknown>>) ||
      []) as Array<Record<string, unknown>>

  /** A form where every field a user could fill in IS filled in. */
  const filledEnv = (
    fields: Array<Record<string, unknown>>,
  ): Record<string, string> => {
    const env: Record<string, string> = {}
    for (const f of fields) {
      const name = String(f.name || "")
      if (!name) continue
      if (f.password || isCredential(name)) env[name] = "sk-test"
      else if (/BASE_URL$|_HOST$|_URL$|_API_BASE$/.test(name))
        env[name] = "https://relay.example.com/v1"
      else if (/PROVIDER$/.test(name))
        env[name] = String(
          f.default || (f.options as string[] | undefined)?.[0] || "openai",
        )
      else if (/MODEL/.test(name)) env[name] = "test-model"
      else if (f.default !== undefined) env[name] = String(f.default)
    }
    return env
  }

  for (const { type, def } of entries) {
    const fields = formFields(type, def)
    const hasCredential = fields.some((f) =>
      isCredential(String(f.name || "")),
    )
    const test = hasCredential ? it : it.skip
    test(`${type}`, async () => {
      // Deep enough for a model list plus the completion, whatever the route.
      script = Array.from({ length: 6 }, () => ok(CHAT_OK()))
      const r = await testLLMConnection(filledEnv(fields))
      expect(r.error || "").not.toMatch(/No API key to test/i)
    })
  }
})

/**
 * A gateway's catalogue and what its backend will actually serve are not the
 * same set. Measured against the OpenAgents credits gateway (2026-09-12),
 * roughly half of the models it advertises answer `model not found`.
 */
describe("testLLMConnection against a catalogue with dead entries", () => {
  const dead = {
    kind: "ok" as const,
    status: 404,
    body: JSON.stringify({
      detail: 'Backend API error: {"error":{"message":"model not found"}}',
    }),
  }

  it("moves on to the next advertised model when one isn't really there", async () => {
    script = [
      ok(JSON.stringify({ data: [{ id: "alibaba-qwen3-32b" }, { id: "deepseek-3.2" }] })),
      dead,
      ok(CHAT_OK("deepseek-3.2")),
    ]
    const r = await testLLMConnection({
      LLM_API_KEY: "sk-gw",
      LLM_BASE_URL: "https://api-gateway.example.org/v1",
    })
    expect(r.success).toBe(true)
    expect(r.model).toBe("deepseek-3.2")
  })

  it("blames the catalogue, not the key, when none of them resolve", async () => {
    script = [
      ok(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] })),
      dead,
      dead,
      dead,
    ]
    const r = await testLLMConnection({
      LLM_API_KEY: "sk-gw",
      LLM_BASE_URL: "https://api-gateway.example.org/v1",
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/lists models it doesn't serve/)
    expect(r.error).toMatch(/key and the endpoint look reachable/)
  })

  it("never substitutes a model the user typed", async () => {
    // Silently testing a different model would make the verdict a lie about
    // the config actually being saved.
    script = [dead, dead]
    const r = await testLLMConnection({
      LLM_API_KEY: "sk-gw",
      LLM_BASE_URL: "https://api-gateway.example.org/v1",
      LLM_MODEL: "glm-5",
    })
    expect(r.success).toBe(false)
    expect(calls).toHaveLength(1)
    expect(r.error).toMatch(/doesn't serve 'glm-5'/)
  })

  it("stops at a bad key instead of retrying every model", async () => {
    script = [
      ok(JSON.stringify({ data: [{ id: "a" }, { id: "b" }, { id: "c" }] })),
      { kind: "ok", status: 401, body: '{"error":{"message":"invalid api key"}}' },
    ]
    const r = await testLLMConnection({
      LLM_API_KEY: "sk-bad",
      LLM_BASE_URL: "https://api-gateway.example.org/v1",
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/401/)
    // One list + one rejected completion. Not four.
    expect(calls).toHaveLength(2)
  })
})
