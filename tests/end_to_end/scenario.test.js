"use strict"

/**
 * The per-agent scenario against a stub control server.
 *
 * It exercises the real sequence — install → create → configure → connect →
 * start → respond → cleanup — including the polling and the exact routes and
 * payloads, so a wiring mistake between the harness and the control server is
 * caught here instead of forty minutes into a nightly run. What it cannot
 * prove is the launcher's half of those routes; that is
 * packages/launcher/src/main/control-server.test.ts.
 */

const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { Control } = require("./lib/control")
const { runAgent } = require("./lib/scenario")
const { stubLauncher, listen } = require("./stub-launcher")

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oa-e2e-run-"))
  const config = {
    homeDir: home,
    keep: false,
    reinstall: false,
    timeouts: {
      install: 20_000,
      start: 4_000,
      reply: 8_000,
      settle: 0,
      poll: 100,
    },
  }
  const agent = {
    type: "openclaw",
    apiKey: "sk-secret-key-value",
    baseUrl: "https://gw/v1",
    model: "m-1",
    env: {},
    files: { "~/.stub/config": "key=${apiKey}\n" },
    prompt: "What is 2+2? Reply with just the number.",
    expect: "4",
    skip: null,
  }
  return { home, config, agent }
}

async function withStub(opts, fn) {
  const { server, state } = stubLauncher(opts)
  const { port, close } = await listen(server)
  const control = new Control({ port, token: "tok" })
  try {
    return await fn({ control, state })
  } finally {
    close()
  }
}

test("a full agent scenario passes and leaves nothing behind", async () => {
  const { home, config, agent } = fixture()
  const result = await withStub({}, async ({ control, state }) => {
    const result = await runAgent({
      control,
      config,
      agent,
      workspace: { id: "w1", slug: "acme" },
      log: () => {},
      outDir: path.join(home, "out"),
      redact: (s) => s,
    })
    assert.deepStrictEqual(state.env.env, {
      LLM_API_KEY: "sk-secret-key-value",
      LLM_BASE_URL: "https://gw/v1",
    })
    assert.strictEqual(state.connected.workspace, "acme")
    assert.strictEqual(state.sent.content, agent.prompt)
    assert.strictEqual(
      state.agents.length,
      0,
      "the agent should be removed at the end",
    )
    // Config files declared for the agent land under the run's HOME.
    assert.strictEqual(
      fs.readFileSync(path.join(home, ".stub", "config"), "utf-8"),
      "key=sk-secret-key-value\n",
    )
    return result
  })

  assert.strictEqual(result.status, "pass", result.reason || "")
  assert.match(result.reply, /4/)
  assert.deepStrictEqual(
    result.steps.map((s) => `${s.name}:${s.status}`),
    [
      "install:ok",
      "create:ok",
      "configure:ok",
      "connect:ok",
      "start:ok",
      "respond:ok",
    ],
  )
  fs.rmSync(home, { recursive: true, force: true })
})

test("a wrong answer fails at `respond` and writes diagnostics", async () => {
  const { home, config, agent } = fixture()
  const outDir = path.join(home, "out")
  const result = await withStub(
    { reply: "I cannot help with that." },
    ({ control }) =>
      runAgent({
        control,
        config,
        agent,
        workspace: { id: "w1", slug: "acme" },
        log: () => {},
        outDir,
        redact: (s) => s.split("sk-secret-key-value").join("***"),
      }),
  )
  assert.strictEqual(result.status, "fail")
  assert.match(result.reason, /did not contain "4"/)
  assert.strictEqual(
    result.steps.find((s) => s.status === "fail").name,
    "respond",
  )
  assert.ok(fs.existsSync(path.join(outDir, "openclaw", "daemon.log")))
  fs.rmSync(home, { recursive: true, force: true })
})

test("an agent that never starts fails at `start`, not at `respond`", async () => {
  const { home, config, agent } = fixture()
  const result = await withStub({ failStart: true }, ({ control }) =>
    runAgent({
      control,
      config,
      agent,
      workspace: { id: "w1", slug: "acme" },
      log: () => {},
      outDir: path.join(home, "out"),
      redact: (s) => s,
    }),
  )
  assert.strictEqual(result.status, "fail")
  assert.strictEqual(
    result.steps.find((s) => s.status === "fail").name,
    "start",
  )
  assert.match(result.reason, /state=stopped/)
  fs.rmSync(home, { recursive: true, force: true })
})

test("a missing credential skips the agent instead of failing it", async () => {
  const { home, config, agent } = fixture()
  const result = await withStub({}, ({ control }) =>
    runAgent({
      control,
      config,
      agent: { ...agent, apiKey: "" },
      workspace: { id: "w1", slug: "acme" },
      log: () => {},
      outDir: path.join(home, "out"),
      redact: (s) => s,
    }),
  )
  assert.strictEqual(result.status, "skip")
  assert.match(result.reason, /no credential for LLM_API_KEY/)
  fs.rmSync(home, { recursive: true, force: true })
})
