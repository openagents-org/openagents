"use strict"

/**
 * Unit tests for the harness itself — `node --test tests/end_to_end/`.
 *
 * The end-to-end run is slow, credentialed and machine-dependent; these cover
 * the pure logic inside it (credential mapping, reply detection, config
 * precedence, the control client's error handling) so a broken harness is
 * caught in a second rather than 40 minutes into a nightly.
 */

const assert = require("node:assert")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildEnv,
  missingRequired,
  isAnswer,
  agentError,
  containsAnswer,
  instanceName,
} = require("./lib/scenario")
const { buildConfig, validate, secretsOf } = require("./lib/config")
const { Control, readControlPort, startupLogSize } = require("./lib/control")
const { summarize, renderMarkdown } = require("./lib/report")
const { makeRedactor, renderTable } = require("./lib/util")

const FIELDS = [
  { name: "LLM_API_KEY", required: true },
  {
    name: "LLM_BASE_URL",
    required: false,
    default: "https://api.openai.com/v1",
  },
  { name: "LLM_MODEL", required: false },
]

test("buildEnv maps credentials onto the launcher's own field names", () => {
  const env = buildEnv(FIELDS, {
    apiKey: "sk-1",
    baseUrl: "https://gw/v1",
    model: "m-1",
    env: {},
  })
  assert.deepStrictEqual(env, {
    LLM_API_KEY: "sk-1",
    LLM_BASE_URL: "https://gw/v1",
    LLM_MODEL: "m-1",
  })
})

test("buildEnv falls back to a field's default and lets explicit env win", () => {
  const env = buildEnv(FIELDS, {
    apiKey: "sk-1",
    baseUrl: "",
    model: "",
    env: { LLM_MODEL: "override", EXTRA: "1" },
  })
  assert.strictEqual(env.LLM_BASE_URL, "https://api.openai.com/v1")
  assert.strictEqual(env.LLM_MODEL, "override")
  assert.strictEqual(env.EXTRA, "1")
})

test("missingRequired names only the required fields with nothing to put in them", () => {
  assert.deepStrictEqual(missingRequired(FIELDS, { LLM_MODEL: "m" }), [
    "LLM_API_KEY",
  ])
  assert.deepStrictEqual(missingRequired(FIELDS, { LLM_API_KEY: "sk" }), [])
})

test("isAnswer ignores our own message, thinking chatter, and other agents", () => {
  const mine = (over) => ({
    messageId: "1",
    senderType: "agent",
    senderName: "e2e-openclaw-mac-x",
    content: "4",
    ...over,
  })
  assert.strictEqual(isAnswer(mine(), "e2e-openclaw-mac-x"), true)
  assert.strictEqual(
    isAnswer(mine({ senderType: "human" }), "e2e-openclaw-mac-x"),
    false,
  )
  assert.strictEqual(
    isAnswer(mine({ messageType: "thinking" }), "e2e-openclaw-mac-x"),
    false,
  )
  assert.strictEqual(
    isAnswer(mine({ content: "  " }), "e2e-openclaw-mac-x"),
    false,
  )
  assert.strictEqual(
    isAnswer(mine({ content: "Thinking..." }), "e2e-openclaw-mac-x"),
    false,
  )
  assert.strictEqual(
    isAnswer(
      { ...mine(), senderType: "system", senderName: "other-agent" },
      "e2e-x",
    ),
    false,
  )
})

test("agentError catches an adapter's failure text posted as a chat message", () => {
  // The false positive this exists for: an error naming the model contains the
  // digit the arithmetic answer was checked against, so a substring test on
  // "4" reported a broken agent as passing.
  assert.ok(
    agentError(
      "Error processing message: CLI exited 1: candidate_failed requested=custom/deepseek-4-flash",
    ),
  )
  assert.ok(agentError("Agent error: boom"))
  assert.ok(
    agentError("codex CLI not found. Install with: npm i -g @openai/codex"),
  )
  assert.ok(agentError("Working directory does not exist: /nope"))
  // Real answers, including one that merely mentions the word.
  assert.strictEqual(agentError("4"), null)
  assert.strictEqual(agentError("The answer is 4."), null)
  assert.strictEqual(agentError("I get 4 as the error-free answer"), null)
})

test("containsAnswer matches the answer as a token, not inside a model name", () => {
  // Both halves came from real runs. The first is the false positive that made
  // a broken agent pass; the second is Hermes, which prints a warning banner
  // and then the answer — rejecting it would have been the opposite mistake.
  assert.strictEqual(
    containsAnswer(
      "Error processing message: CLI exited 1: candidate_failed requested=custom/deepseek-4-flash",
      "4",
    ),
    false,
  )
  assert.strictEqual(containsAnswer("gpt-4-turbo is not available", "4"), false)
  assert.strictEqual(containsAnswer("Pi error: Connection error.", "4"), false)

  assert.strictEqual(containsAnswer("4", "4"), true)
  assert.strictEqual(containsAnswer("The answer is 4.", "4"), true)
  assert.strictEqual(containsAnswer("2+2 = 4", "4"), true)
  assert.strictEqual(
    containsAnswer("⚠ scanner unavailable — pattern matching only\n4", "4"),
    true,
  )
  // Regex metacharacters in `expect` are literal, not a pattern.
  assert.strictEqual(containsAnswer("the total is 1.5", "1.5"), true)
  assert.strictEqual(containsAnswer("the total is 155", "1.5"), false)
})

test("instanceName is unique, tagged with the platform, and short", () => {
  const a = instanceName("openclaw")
  assert.match(a, /^e2e-openclaw-(mac|win|lx)-[a-z0-9]+$/)
  assert.ok(a.length <= 38, `${a} is too long`)
})

test("config resolves file → env → flags, in that order of precedence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-e2e-cfg-"))
  const file = path.join(dir, "config.json")
  fs.writeFileSync(
    file,
    JSON.stringify({
      workspace: {
        id: "from-file",
        token: "tok-file",
        apiBase: "https://file",
      },
      defaults: { apiKey: "sk-default", baseUrl: "https://gw/v1" },
      agents: { openclaw: { model: "m-1" }, cursor: { skip: "no key" } },
    }),
  )
  const saved = { ...process.env }
  process.env.OA_E2E_WS_ID = "from-env"
  process.env.OA_E2E_OPENCLAW_API_KEY = "sk-env"
  try {
    const config = buildConfig([
      `--config=${file}`,
      "--ws-token=tok-flag",
      "--agents=openclaw",
    ])
    assert.strictEqual(config.workspace.id, "from-env") // env beats the file
    assert.strictEqual(config.workspace.token, "tok-flag") // a flag beats both
    assert.strictEqual(config.agents.length, 1) // --agents narrows the matrix
    assert.strictEqual(config.agents[0].apiKey, "sk-env")
    assert.strictEqual(config.agents[0].baseUrl, "https://gw/v1") // from defaults
    assert.deepStrictEqual(validate(config), [])
    assert.ok(secretsOf(config).includes("sk-env"))
  } finally {
    process.env = saved
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("config refuses to start without a workspace or an agent", () => {
  const saved = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("OA_E2E_")) delete process.env[key]
  }
  delete process.env.WORKSPACE_API_BASE_URL
  try {
    const problems = validate(
      buildConfig(["--config=" + path.join(os.tmpdir(), "nope.json")]),
    )
    assert.ok(false, `expected a missing-config error, got ${problems}`)
  } catch (err) {
    assert.match(err.message, /config file not found/)
  } finally {
    process.env = saved
  }
})

test("readControlPort ignores a previous run's port line", () => {
  // The regression that cost a warm-profile run its whole boot timeout: the
  // reused log still ended with yesterday's (dead) port, and the app writes its
  // token file before it logs today's.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oa-e2e-home2-"))
  fs.mkdirSync(path.join(home, ".openagents"), { recursive: true })
  const log = path.join(home, ".openagents", "startup.log")
  fs.writeFileSync(
    log,
    "2026-01-01Z Control server on 127.0.0.1:64354 (token: x)\n",
  )

  const baseline = startupLogSize(home)
  assert.strictEqual(
    readControlPort(home, baseline),
    null,
    "stale line must not count",
  )

  fs.appendFileSync(log, "2026-01-02Z booting\n")
  assert.strictEqual(readControlPort(home, baseline), null)

  fs.appendFileSync(
    log,
    "2026-01-02Z Control server on 127.0.0.1:50487 (token: x)\n",
  )
  assert.strictEqual(readControlPort(home, baseline), 50487)
  fs.rmSync(home, { recursive: true, force: true })
})

test("readControlPort takes the port from the newest startup-log line", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oa-e2e-home-"))
  fs.mkdirSync(path.join(home, ".openagents"), { recursive: true })
  const log = path.join(home, ".openagents", "startup.log")
  assert.strictEqual(readControlPort(home), null)
  fs.writeFileSync(
    log,
    [
      "2026-01-01T00:00:00Z Control server on 127.0.0.1:4599 (token: x)",
      "2026-01-01T00:05:00Z something else",
      "2026-01-02T00:00:00Z Control server on 127.0.0.1:51234 (token: x)",
      "",
    ].join("\n"),
  )
  assert.strictEqual(readControlPort(home), 51234)
  fs.rmSync(home, { recursive: true, force: true })
})

test("the control client sends the token and surfaces server errors", async () => {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push([req.method, req.url, req.headers.authorization])
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ coreReady: true }))
    }
    res.writeHead(503, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "core not loaded yet — retry shortly" }))
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const control = new Control({ port: server.address().port, token: "tok" })
  try {
    assert.deepStrictEqual(await control.status(), { coreReady: true })
    assert.deepStrictEqual(seen[0], ["GET", "/status", "Bearer tok"])
    await assert.rejects(control.workspaces(), /503: core not loaded/)

    // waitFor rides out failing probes until the deadline, then says what it saw.
    await assert.rejects(
      control.waitFor(() => control.workspaces(), {
        timeoutMs: 300,
        intervalMs: 100,
        label: "workspaces",
      }),
      /timed out .* waiting for workspaces .*core not loaded/,
    )
  } finally {
    server.close()
  }
})

test("the report counts outcomes and shows the step that failed", () => {
  const run = {
    startedAt: "2026-08-27T00:00:00.000Z",
    durationMs: 60_000,
    platform: "darwin",
    arch: "arm64",
    launcherVersion: "0.9.23",
    coreVersion: "0.2.173",
    workspace: { id: "w1", slug: "acme" },
    results: [
      {
        type: "openclaw",
        status: "pass",
        durationMs: 30_000,
        reply: "4",
        steps: [],
      },
      {
        type: "codex",
        status: "fail",
        durationMs: 20_000,
        reason: 'answer did not contain "4"',
        steps: [
          { name: "install", status: "ok", durationMs: 1000 },
          {
            name: "respond",
            status: "fail",
            durationMs: 19_000,
            detail: "no reply",
          },
        ],
      },
      {
        type: "cursor",
        status: "skip",
        durationMs: 0,
        reason: "no key",
        steps: [],
      },
    ],
  }
  assert.deepStrictEqual(summarize(run.results), {
    total: 3,
    pass: 1,
    fail: 1,
    skip: 1,
  })
  const md = renderMarkdown(run)
  assert.match(md, /\| codex \| FAIL \|/)
  assert.match(md, /### codex \(respond\)/)
})

test("secrets are redacted everywhere output is written", () => {
  const redact = makeRedactor(["sk-super-secret-value", "short", ""])
  assert.strictEqual(redact("key=sk-super-secret-value done"), "key=*** done")
  assert.strictEqual(redact("short stays"), "short stays") // too short to be a key
})

test("renderTable pads columns to the widest cell", () => {
  const table = renderTable(
    ["A", "BB"],
    [
      ["1", "2"],
      ["333", "4"],
    ],
  )
  assert.deepStrictEqual(table.split("\n"), [
    "A    BB",
    "---  --",
    "1    2",
    "333  4",
  ])
})
