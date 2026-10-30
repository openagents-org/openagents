"use strict"

/**
 * The entry point itself, against stubbed services.
 *
 * Runs `run.js --attach` as a real child process with a stub control server and
 * a stub workspace API behind it, so the orchestration — config, attach,
 * pairing, the per-agent loop, the report and the exit code — is covered
 * without a launcher, a workspace, or a single API key.
 */

const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFile } = require("node:child_process")
const { test } = require("node:test")

const { stubLauncher, stubWorkspaceApi, listen } = require("./stub-launcher")

const RUN_JS = path.join(__dirname, "run.js")

/** A HOME that looks like one a launcher is already running under. */
function fakeProfile(port) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "oa-e2e-attach-"))
  const dir = path.join(home, ".openagents")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "control.token"), "tok")
  fs.writeFileSync(
    path.join(dir, "startup.log"),
    `2026-08-27T00:00:00Z Control server on 127.0.0.1:${port} (token: x)\n`,
  )
  return home
}

function writeConfig(home, agents) {
  const file = path.join(home, "agents.config.json")
  fs.writeFileSync(
    file,
    JSON.stringify({
      defaults: { apiKey: "sk-secret-key-value", baseUrl: "https://gw/v1" },
      agents,
    }),
  )
  return file
}

function runScript(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [RUN_JS, ...args],
      // A clean OA_E2E_* environment: the developer running these tests may
      // have their own credentials exported.
      {
        env: Object.fromEntries(
          Object.entries(process.env).filter(([k]) => !k.startsWith("OA_E2E_")),
        ),
      },
      (err, stdout, stderr) => {
        resolve({ code: err ? err.code : 0, stdout, stderr })
      },
    )
  })
}

async function withStubs(opts, fn) {
  const launcher = stubLauncher(opts)
  const workspace = stubWorkspaceApi({ workspaceId: "acme" })
  const l = await listen(launcher.server)
  const w = await listen(workspace.server)
  const home = fakeProfile(l.port)
  try {
    return await fn({ home, launcher, workspace, wsPort: w.port })
  } finally {
    l.close()
    w.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
}

function baseArgs({ home, wsPort, config }) {
  return [
    "--attach",
    `--home=${home}`,
    `--out=${path.join(home, "out")}`,
    `--config=${config}`,
    `--ws-api=http://127.0.0.1:${wsPort}`,
    "--ws-token=wst-secret-token",
    "--ws-id=acme",
    "--settle=0",
    "--poll=0.1",
    "--json",
  ]
}

test("a green run pairs, tests every agent, and exits 0", async () => {
  await withStubs({}, async ({ home, launcher, workspace, wsPort }) => {
    const config = writeConfig(home, {
      openclaw: { model: "m-1" },
      cursor: { skip: "no unattended login" },
    })
    const { code, stdout } = await runScript(baseArgs({ home, wsPort, config }))
    assert.strictEqual(code, 0, stdout)

    const run = JSON.parse(stdout)
    assert.strictEqual(run.ok, true)
    assert.deepStrictEqual(run.summary, { total: 2, pass: 1, fail: 0, skip: 1 })
    assert.strictEqual(run.results[0].type, "openclaw")
    assert.strictEqual(run.results[0].status, "pass")
    assert.strictEqual(run.results[1].status, "skip")
    assert.strictEqual(run.launcherVersion, "0.9.23")
    assert.strictEqual(run.workspace.slug, "acme")

    // It really did pair, with a code it minted for this run.
    assert.strictEqual(launcher.state.paired, workspace.state.minted[0])
    // Cleanup covers BOTH sides: the daemon's agent and the workspace's member
    // row. Only removing the first leaves a dead member behind on every run.
    assert.deepStrictEqual(workspace.state.removedMembers, [
      run.results[0].instance,
    ])
    // Attach mode leaves the launcher running — it is not ours to quit.
    assert.strictEqual(launcher.state.quit, 0)

    // Secrets never reach the results, and the summary is on disk for the job
    // that collects it.
    assert.ok(!stdout.includes("sk-secret-key-value"))
    assert.ok(!stdout.includes("wst-secret-token"))
    const latest = JSON.parse(
      fs.readFileSync(path.join(home, "out", "latest.json"), "utf-8"),
    )
    assert.strictEqual(latest.ok, true)
  })
})

test("a wrong answer makes the run exit 1", async () => {
  await withStubs({ reply: "no idea" }, async ({ home, wsPort }) => {
    const config = writeConfig(home, { openclaw: { model: "m-1" } })
    const { code, stdout } = await runScript(baseArgs({ home, wsPort, config }))
    assert.strictEqual(code, 1)
    const run = JSON.parse(stdout)
    assert.strictEqual(run.ok, false)
    assert.strictEqual(run.results[0].status, "fail")
  })
})

test("an agent the installed core cannot run is skipped, not failed", async () => {
  await withStubs({}, async ({ home, wsPort }) => {
    // The stub core supports openclaw and codex only.
    const config = writeConfig(home, { hermes: { model: "m-1" } })
    const { code, stdout } = await runScript(baseArgs({ home, wsPort, config }))
    assert.strictEqual(code, 0)
    const run = JSON.parse(stdout)
    assert.strictEqual(run.results[0].status, "skip")
    assert.match(run.results[0].reason, /adapter map/)
  })
})

test("a workspace that cannot be reached aborts before touching the launcher", async () => {
  await withStubs({}, async ({ home, wsPort, launcher }) => {
    const config = writeConfig(home, { openclaw: { model: "m-1" } })
    const args = baseArgs({ home, wsPort, config }).map((a) =>
      a.startsWith("--ws-id=") ? "--ws-id=missing" : a,
    )
    const { code, stdout } = await runScript(args)
    assert.strictEqual(code, 1)
    const run = JSON.parse(stdout)
    assert.match(run.error, /404/)
    assert.deepStrictEqual(run.results, [])
    assert.ok(!launcher.state.calls.includes("POST /pair"))
  })
})

test("missing credentials stop the run before anything slow happens", async () => {
  const { code, stderr } = await runScript([
    "--config=/nonexistent/config.json",
  ])
  assert.strictEqual(code, 1)
  assert.match(stderr, /config file not found/)
})
